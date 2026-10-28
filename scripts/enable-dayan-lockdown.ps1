[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [switch]$ConfirmLockdown,
  [string]$UserSid,
  [string]$BackupPath
)

$ErrorActionPreference = 'Stop'

if (-not $ConfirmLockdown) {
  throw 'This changes the current Windows user policy. Re-run with -ConfirmLockdown after signing in as the dedicated DAYAN kiosk user.'
}

$appData = Join-Path $env:APPDATA 'DAYAN时钟'
$backupPath = if ($BackupPath) { $BackupPath } else { Join-Path $appData 'windows-lockdown-backup.json' }
if (-not $UserSid) { $UserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value }
if ($UserSid -notmatch '^S-\d-\d+(-\d+)+$') { throw 'Invalid target user SID.' }
$root = "Registry::HKEY_USERS\$UserSid"
$systemKey = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\System"
$explorerKey = "$root\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"

New-Item -ItemType Directory -Path (Split-Path -Parent $backupPath) -Force | Out-Null
New-Item -Path $systemKey -Force | Out-Null
New-Item -Path $explorerKey -Force | Out-Null

$items = @(
  @{ Path = $systemKey; Name = 'DisableTaskMgr' },
  @{ Path = $systemKey; Name = 'DisableLockWorkstation' },
  @{ Path = $systemKey; Name = 'DisableChangePassword' },
  @{ Path = $explorerKey; Name = 'NoWinKeys' },
  @{ Path = $explorerKey; Name = 'NoLogoff' }
)
if (-not (Test-Path -LiteralPath $backupPath)) {
  $backup = [ordered]@{}
  foreach ($item in $items) {
    $key = "$($item.Path)::$($item.Name)"
    $existing = Get-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction SilentlyContinue
    $backup[$key] = if ($null -ne $existing) { @{ Exists = $true; Value = [int]$existing.($item.Name) } } else { @{ Exists = $false } }
  }
  $backup | ConvertTo-Json | Set-Content -LiteralPath $backupPath -Encoding UTF8
}

New-ItemProperty -Path $systemKey -Name DisableTaskMgr -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $systemKey -Name DisableLockWorkstation -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $systemKey -Name DisableChangePassword -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $explorerKey -Name NoWinKeys -PropertyType DWord -Value 1 -Force | Out-Null
New-ItemProperty -Path $explorerKey -Name NoLogoff -PropertyType DWord -Value 1 -Force | Out-Null

foreach ($item in $items) {
  if ((Get-ItemProperty -Path $item.Path -Name $item.Name -ErrorAction Stop).($item.Name) -ne 1) { throw "Policy verification failed: $($item.Name)" }
}

Write-Output 'DAYAN Windows lockdown policy enabled for the current user.'
Write-Output "Backup: $backupPath"
Write-Output 'Sign out and sign in again, or run gpupdate /force, before testing.'
