[CmdletBinding()]
param([switch]$ConfirmKeyboardFilter, [string]$UserSid, [string]$BackupPath)

$ErrorActionPreference = 'Stop'
if (-not $ConfirmKeyboardFilter) { throw 'Keyboard Filter authorization requires explicit confirmation.' }
$featureName = 'Client-KeyboardFilter'
$namespace = 'root/standardcimv2/embedded'
$edition = [string](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').EditionID
if ($edition -notmatch 'Enterprise|Education|IoT') { return @{ stage = 'unsupported'; message = 'This Windows edition does not provide Microsoft Keyboard Filter.' } }
$feature = Get-WindowsOptionalFeature -Online -FeatureName $featureName -ErrorAction Stop
if (-not $BackupPath) { throw 'A backup path is required.' }
$boot = (Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).LastBootUpTime.ToUniversalTime().ToString('o')
$backup = $null
if (Test-Path -LiteralPath $BackupPath) {
  $backup = Get-Content -Raw -LiteralPath $BackupPath | ConvertFrom-Json
  if ($backup.BackupVersion -ne 1) { throw 'Unsupported Keyboard Filter backup format.' }
} else {
  $backup = [pscustomobject]@{ BackupVersion = 1; FeatureState = [string]$feature.State; SecureKeys = @(); Settings = @(); PendingRestart = $false; ChangedOnBoot = $boot; Configured = $false }
}
function Save-FilterBackup {
  New-Item -ItemType Directory -Path (Split-Path -Parent $BackupPath) -Force | Out-Null
  $temp = $BackupPath + '.tmp'
  $backup | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $temp -Encoding UTF8
  Move-Item -LiteralPath $temp -Destination $BackupPath -Force
}
if ([string]$feature.State -ne 'Enabled') {
  # Persist recovery information before changing an optional Windows feature.
  $backup.PendingRestart = $true
  $backup.ChangedOnBoot = $boot
  Save-FilterBackup
  if ([string]$feature.State -ne 'EnablePending') { Enable-WindowsOptionalFeature -Online -FeatureName $featureName -All -NoRestart -ErrorAction Stop | Out-Null }
  return @{ stage = 'restart-required'; message = 'Keyboard Filter enabled. Restart Windows, then continue authorization in DAYAN settings.' }
}
if ($backup.PendingRestart -and [string]$backup.ChangedOnBoot -eq $boot) {
  return @{ stage = 'restart-required'; message = 'Restart Windows before continuing Keyboard Filter configuration.' }
}
$backup.PendingRestart = $false
$keys = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_PredefinedKey -ErrorAction Stop)
# Microsoft predefined-key ID uses Del, not Delete.
$secureKey = $keys | Where-Object { [string]$_.Id -eq 'Ctrl+Alt+Del' } | Select-Object -First 1
if ($null -eq $secureKey) { throw 'Keyboard Filter provider does not expose Ctrl+Alt+Del.' }
$settings = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_Settings -ErrorAction Stop)
$adminSetting = $settings | Where-Object { [string]$_.Name -eq 'DisableKeyboardFilterForAdministrators' } | Select-Object -First 1
if ($null -eq $adminSetting) { throw 'Keyboard Filter administrator setting is unavailable.' }
if (@($backup.SecureKeys).Count -eq 0) {
  $backup.SecureKeys = @([pscustomobject]@{ Id = 'Ctrl+Alt+Del'; Enabled = [bool]$secureKey.Enabled })
  $backup.Settings = @([pscustomobject]@{ Name = [string]$adminSetting.Name; Value = [string]$adminSetting.Value })
}
Save-FilterBackup
$adminChanged = [string]$adminSetting.Value -ine 'false'
Set-CimInstance -InputObject $secureKey -Property @{ Enabled = $true } -ErrorAction Stop | Out-Null
if ($adminChanged) { Set-CimInstance -InputObject $adminSetting -Property @{ Value = 'false' } -ErrorAction Stop | Out-Null }
$check = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_PredefinedKey -ErrorAction Stop) | Where-Object { $_.Id -eq 'Ctrl+Alt+Del' }
$adminCheck = @(Get-CimInstance -Namespace $namespace -ClassName WEKF_Settings -ErrorAction Stop) | Where-Object { $_.Name -eq 'DisableKeyboardFilterForAdministrators' }
if (@($check).Count -ne 1 -or -not [bool]$check.Enabled -or [string]$adminCheck.Value -ine 'false') { throw 'Keyboard Filter verification failed; backup retained for recovery.' }
$backup.Configured = $true
Save-FilterBackup
# Keep Windows' documented maintenance breakout intact. No automatic reboot,
# sign-out, administrator-account replacement or shell replacement is performed.
return @{ stage = 'configured'; message = $(if ($adminChanged) { 'Rule configured. Sign out and sign in before testing administrator accounts.' } else { 'Ctrl+Alt+Del rule configured. Validate with a physical keyboard on the target device.' }); signInRequired = $adminChanged }
