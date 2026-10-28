[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ConfirmRestore,
  [string]$UserSid,
  [string]$BackupPath
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

$backup = Get-Content -Raw -Path $backupPath | ConvertFrom-Json
$targets = @{
  DisableTaskMgr = $systemKey
  DisableLockWorkstation = $systemKey
  DisableChangePassword = $systemKey
  NoWinKeys = $explorerKey
  NoLogoff = $explorerKey
}
$records = @($backup.PSObject.Properties)
if ($records.Count -ne $targets.Count) { throw 'Policy backup is incomplete.' }
foreach ($entry in $records) {
  $parts = $entry.Name -split '::', 2
  if ($parts.Count -ne 2 -or -not $targets.ContainsKey($parts[1])) { throw 'Invalid policy backup.' }
  $expectedPath = $targets[$parts[1]]
  $legacyPath = $expectedPath -replace '^Registry::HKEY_USERS\\S-\d-\d+(-\d+)+', 'HKCU:'
  if ($parts[0] -ne $expectedPath -and $parts[0] -ne $legacyPath) { throw 'Policy backup belongs to a different user.' }
}
foreach ($entry in $backup.PSObject.Properties) {
  $parts = $entry.Name -split '::', 2
  $name = $parts[1]
  $path = $targets[$name]
  $record = $entry.Value
  if ($record.Exists) {
    New-Item -Path $path -Force | Out-Null
    New-ItemProperty -Path $path -Name $name -PropertyType DWord -Value ([int]$record.Value) -Force | Out-Null
  } else {
    $existing = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
    if ($null -ne $existing) { Remove-ItemProperty -Path $path -Name $name -ErrorAction Stop }
  }
  $restored = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
  if ($record.Exists -and ($null -eq $restored -or $restored.$name -ne [int]$record.Value)) { throw "Policy restore verification failed: $name" }
  if (-not $record.Exists -and $null -ne $restored) { throw "Policy removal verification failed: $name" }
}

Remove-Item -LiteralPath $backupPath -Force
Write-Output 'DAYAN Windows lockdown policy restored for the current user.'
Write-Output 'Sign out and sign in again, or run gpupdate /force, before testing.'
