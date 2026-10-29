$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot ('../work/filter-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$global:dayanFixture = @{ edition = 'Enterprise'; feature = [pscustomobject]@{ State = 'Enabled' }; boot = [datetime]'2026-10-28T00:00:00Z'; key = [pscustomobject]@{ Id = 'Ctrl+Alt+Del'; Enabled = $false }; setting = [pscustomobject]@{ Name = 'DisableKeyboardFilterForAdministrators'; Value = 'true' }; changes = 0 }
$fixture = $global:dayanFixture
function Get-ItemProperty { param($Path) return [pscustomobject]@{ EditionID = $global:dayanFixture.edition } }
function Get-WindowsOptionalFeature { param([switch]$Online,$FeatureName) return $global:dayanFixture.feature }
function Enable-WindowsOptionalFeature { param([switch]$Online,$FeatureName,[switch]$All,[switch]$NoRestart) $global:dayanFixture.feature.State = 'EnablePending'; $global:dayanFixture.changes++ }
function Get-CimInstance {
  param([Parameter(Position=0)]$ClassName,$Namespace)
  if ($ClassName -eq 'Win32_OperatingSystem') { return [pscustomobject]@{ LastBootUpTime = $global:dayanFixture.boot } }
  if ($ClassName -eq 'WEKF_PredefinedKey') { return $global:dayanFixture.key }
  if ($ClassName -eq 'WEKF_Settings') { return $global:dayanFixture.setting }
  throw 'Unexpected provider query'
}
function Set-CimInstance { param($InputObject,$Property) foreach($name in $Property.Keys) { $InputObject.$name = $Property[$name] }; $global:dayanFixture.changes++ }
function Assert($condition,$message) { if (-not $condition) { throw $message } }
$enable = Join-Path $PSScriptRoot '../scripts/enable-dayan-keyboard-filter.ps1'
$restore = Join-Path $PSScriptRoot '../scripts/restore-dayan-keyboard-filter.ps1'
$backup = Join-Path $root 'backup.json'
$checks = @()
try { & $enable -BackupPath $backup; throw 'Confirmation check missing' } catch { Assert ($_.Exception.Message -match 'explicit confirmation') 'Authorization must require confirmation' }
$checks += 'Explicit authorization required before changing system configuration'
$fixture.edition = 'Professional'
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
Assert ($result.stage -eq 'unsupported' -and $fixture.changes -eq 0 -and -not (Test-Path $backup)) 'Unsupported editions must not change anything'
$checks += 'Professional edition returns unsupported without system mutation'
$fixture.edition = 'Enterprise'
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
Assert ($result.stage -eq 'configured' -and $fixture.key.Enabled -and $fixture.setting.Value -eq 'false') 'Provider rule or Name/Value setting not configured'
$first = Get-Content -Raw -LiteralPath $backup | ConvertFrom-Json
Assert (-not $first.SecureKeys[0].Enabled -and $first.Settings[0].Value -eq 'true') 'Original settings must be backed up'
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
$again = Get-Content -Raw -LiteralPath $backup | ConvertFrom-Json
Assert (-not $again.SecureKeys[0].Enabled -and $again.Settings[0].Value -eq 'true') 'Repeated authorization replaced original backup'
$result = & $restore -ConfirmKeyboardRestore -BackupPath $backup
Assert (-not $fixture.key.Enabled -and $fixture.setting.Value -eq 'true' -and -not (Test-Path $backup)) 'Restore did not recover original values'
$checks += 'Documented Ctrl+Alt+Del ID and Name/Value setting configured; first backup preserved; original values restored'
$fixture.feature.State = 'Disabled'
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
Assert ($result.stage -eq 'restart-required' -and -not $fixture.key.Enabled -and (Test-Path $backup)) 'Feature install must report pending reboot before rules are enabled'
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
Assert ($result.stage -eq 'restart-required' -and -not $fixture.key.Enabled) 'Same boot must remain pending'
$fixture.feature.State = 'Enabled'
$fixture.boot = $fixture.boot.AddDays(1)
$result = & $enable -ConfirmKeyboardFilter -BackupPath $backup
Assert ($result.stage -eq 'configured' -and $fixture.key.Enabled) 'Configuration must continue after reboot'
$checks += 'Feature activation backs up before install, reports reboot pending, and continues configuration after a new boot'
@{ result = 'passed'; fixtureOnly = $true; root = $root; checks = $checks } | ConvertTo-Json -Depth 5
