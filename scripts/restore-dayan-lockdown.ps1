[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ConfirmRestore,
  [string]$UserSid,
  [string]$BackupPath,
  [switch]$ValidateOnly,
  [switch]$PassThru
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmRestore) {
  throw 'This restores the current Windows user policy. Re-run with -ConfirmRestore.'
}

$appData = Join-Path $env:APPDATA 'DAYAN时钟'
$backupPath = if ($BackupPath) { $BackupPath } else { Join-Path $appData 'windows-lockdown-backup.json' }
if (-not $UserSid) { $UserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
if ($UserSid -notmatch '^S-\d-\d+(-\d+)+$') { throw 'Invalid target user SID.' }
$root = "Registry::HKEY_USERS\$UserSid"
$systemKey = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\System"
$explorerKey = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"

if (-not (Test-Path $backupPath)) {
  throw "Backup not found: $backupPath"
}

$backup = Get-Content -Raw -LiteralPath $backupPath -Encoding UTF8 | ConvertFrom-Json
$targets = @{
  DisableTaskMgr = $systemKey
  DisableLockWorkstation = $systemKey
  DisableChangePassword = $systemKey
  NoWinKeys = $explorerKey
  NoLogoff = $explorerKey
}
$records = @($backup.PSObject.Properties)
if ($records.Count -ne $targets.Count) { throw 'Policy backup is incomplete.' }
$plan = @()
$seen = @{}
foreach ($entry in $records) {
  # Registry:: is part of the provider path; the value follows the LAST ::.
  $separator = $entry.Name.LastIndexOf('::')
  if ($separator -lt 1) { throw 'Invalid policy backup.' }
  $name = $entry.Name.Substring($separator + 2)
  $sourcePath = $entry.Name.Substring(0, $separator)
  if (-not $targets.ContainsKey($name) -or $seen.ContainsKey($name)) { throw 'Invalid or duplicate policy in backup.' }
  $seen[$name] = $true
  $expectedPath = $targets[$name]
  $legacyPath = $expectedPath -replace '^Registry::HKEY_USERS\\S-\d-\d+(-\d+)+', 'HKCU:'
  if ($sourcePath -ine $expectedPath -and $sourcePath -ine $legacyPath) { throw 'Policy backup belongs to a different user.' }
  $record = $entry.Value
  if ($null -eq $record -or $record.Exists -isnot [bool]) { throw "Invalid existence flag in backup: $name" }
  $value = $null
  if ($record.Exists) {
    $number = 0L
    if ($record.Value -is [bool] -or -not [long]::TryParse([string]$record.Value, [ref]$number) -or $number -lt [int32]::MinValue -or $number -gt [uint32]::MaxValue) { throw "Invalid DWORD value in backup: $name" }
    $value = [uint32]($number -band 0xffffffffL)
  }
  $plan += [pscustomobject]@{ Name = $name; Path = $expectedPath; Exists = $record.Exists; Value = $value }
}
if ($ValidateOnly) { return @{ stage = 'validated'; policies = $plan } }
function Read-PolicyValue([string]$Path, [string]$Name) {
  try { return Get-ItemProperty -Path $Path -Name $Name -ErrorAction Stop }
  catch [System.Management.Automation.ItemNotFoundException] { return $null }
  catch [System.Management.Automation.PSArgumentException] { return $null }
}
$skipped = $false
foreach ($record in $plan) {
  $name = $record.Name
  $path = $record.Path
  if ($record.Exists) {
    if (-not $PSCmdlet.ShouldProcess("${path}::$name", 'Restore original policy value')) { $skipped = $true; continue }
    New-Item -Path $path -Force | Out-Null
    $signedValue = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$record.Value), 0)
    New-ItemProperty -Path $path -Name $name -PropertyType DWord -Value $signedValue -Force | Out-Null
  } else {
    if (-not $PSCmdlet.ShouldProcess("${path}::$name", 'Remove DAYAN policy value')) { $skipped = $true; continue }
    $existing = Read-PolicyValue $path $name
    if ($null -ne $existing) { Remove-ItemProperty -Path $path -Name $name -ErrorAction Stop }
  }
}
if ($WhatIfPreference -or $skipped) { return }
# Verify the complete set after all writes; retain the backup on any failure.
foreach ($record in $plan) {
  $path = $record.Path
  $name = $record.Name
  $restored = Read-PolicyValue $path $name
  $actualValue = if ($null -ne $restored) { [uint32]([long]$restored.$name -band 0xffffffffL) } else { $null }
  if ($record.Exists -and ($null -eq $restored -or $actualValue -ne $record.Value)) { throw "Policy restore verification failed: $name" }
  if (-not $record.Exists -and $null -ne $restored) { throw "Policy removal verification failed: $name" }
}

Remove-Item -LiteralPath $backupPath -Force
if ($PassThru) { return @{ stage = 'restored'; policies = $plan } }
Write-Output 'DAYAN Windows lockdown policy restored for the current user.'
Write-Output 'Sign out and sign in again, or run gpupdate /force, before testing.'
