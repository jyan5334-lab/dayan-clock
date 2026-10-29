[CmdletBinding()]
param([switch]$ConfirmKeyboardRestore, [string]$UserSid, [string]$BackupPath)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmKeyboardRestore) { throw 'Keyboard Filter restore requires explicit confirmation.' }
if (-not $BackupPath) { throw 'A backup path is required.' }
if (-not (Test-Path -LiteralPath $BackupPath)) { return @{ stage = 'unchanged' } }
$backup = Get-Content -Raw -LiteralPath $BackupPath | ConvertFrom-Json
if ($backup.BackupVersion -ne 1) { throw 'Unsupported Keyboard Filter backup format.' }
foreach ($record in @($backup.SecureKeys)) { if ($record.Id -ne 'Ctrl+Alt+Del') { throw 'Unexpected Keyboard Filter key in backup.' } }
foreach ($record in @($backup.Settings)) { if ($record.Name -ne 'DisableKeyboardFilterForAdministrators' -or $record.Value -notmatch '^(?i:true|false)$') { throw 'Unexpected Keyboard Filter setting in backup.' } }
$namespace = 'root/standardcimv2/embedded'
if (@($backup.SecureKeys).Count) {
  $keys = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_PredefinedKey -ErrorAction Stop)
  foreach ($record in @($backup.SecureKeys)) {
    $key = $keys | Where-Object { $_.Id -eq $record.Id } | Select-Object -First 1
    if ($null -eq $key) { throw 'Keyboard Filter key missing; backup retained.' }
    Set-CimInstance -InputObject $key -Property @{ Enabled = [bool]$record.Enabled } -ErrorAction Stop | Out-Null
  }
  $settings = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_Settings -ErrorAction Stop)
  foreach ($record in @($backup.Settings)) {
    $setting = $settings | Where-Object { $_.Name -eq $record.Name } | Select-Object -First 1
    if ($null -eq $setting) { throw 'Keyboard Filter setting missing; backup retained.' }
    Set-CimInstance -InputObject $setting -Property @{ Value = [string]$record.Value } -ErrorAction Stop | Out-Null
  }
  $keys = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_PredefinedKey -ErrorAction Stop)
  foreach ($record in @($backup.SecureKeys)) {
    $key = $keys | Where-Object { $_.Id -eq $record.Id } | Select-Object -First 1
    if ($null -eq $key -or [bool]$key.Enabled -ne [bool]$record.Enabled) { throw 'Keyboard Filter restore verification failed.' }
  }
}
# Leave the optional component installed: disabling it could affect another
# application configured after DAYAN. Restore only the rules DAYAN changed.
Remove-Item -LiteralPath $BackupPath -Force
return @{ stage = 'restored'; message = 'DAYAN Keyboard Filter rules restored. Sign in again if administrator filtering changed.' }
