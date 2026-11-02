param([Parameter(Mandatory = $true)][string]$TestDirectory)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$scripts = Join-Path (Split-Path $PSScriptRoot) 'scripts'
$restore = Join-Path $scripts 'restore-dayan-lockdown.ps1'
$sid = 'S-1-5-21-11-22-33-1001'
$root = "Registry::HKEY_USERS\$sid\Software\Microsoft\Windows\CurrentVersion\Policies"
$names = @('DisableTaskMgr', 'DisableLockWorkstation', 'DisableChangePassword', 'NoWinKeys', 'NoLogoff')
$global:dayanPolicyTestvalues = @{}
$global:dayanPolicyTestwrites = 0
$global:dayanPolicyTestignoreDelete = $false
$global:dayanPolicyTestfailDelete = $false
$global:dayanPolicyTestfailRead = $false
$checks = @()

# These functions intercept every registry operation; no real policy is changed.
function Assert-TestPath([string]$Path) {
  if (-not $Path.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected registry path in isolated test.' }
}
function Get-ItemProperty {
  [CmdletBinding()]param([string]$Path, [string]$Name)
  Assert-TestPath $Path
  if ($global:dayanPolicyTestfailRead) { throw [UnauthorizedAccessException]::new('Simulated read access denied') }
  if ($global:dayanPolicyTestvalues.ContainsKey($Name)) { return [pscustomobject]@{ $Name = $global:dayanPolicyTestvalues[$Name] } }
}
function New-Item {
  [CmdletBinding()]param([string]$Path, [switch]$Force)
  Assert-TestPath $Path
}
function New-ItemProperty {
  [CmdletBinding()]param([string]$Path, [string]$Name, [string]$PropertyType, $Value, [switch]$Force)
  Assert-TestPath $Path
  if ($PropertyType -ne 'DWord') { throw 'Unexpected registry type.' }
  $global:dayanPolicyTestvalues[$Name] = $Value
  $global:dayanPolicyTestwrites++
}
function Remove-ItemProperty {
  [CmdletBinding()]param([string]$Path, [string]$Name)
  Assert-TestPath $Path
  if ($global:dayanPolicyTestfailDelete) { throw 'Simulated registry access denied' }
  if (-not $global:dayanPolicyTestignoreDelete) { $global:dayanPolicyTestvalues.Remove($Name) }
  $global:dayanPolicyTestwrites++
}
function Assert-That([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function New-Backup([string]$File, [bool]$Legacy = $false, [bool]$Mixed = $false) {
  $data = [ordered]@{}
  for ($i = 0; $i -lt $names.Count; $i++) {
    $name = $names[$i]
    $category = if ($i -lt 3) { 'System' } else { 'Explorer' }
    $prefix = if ($Legacy) { 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies' } else { $root }
    $maximum = if ($Legacy) { -1 } else { 4294967295 }
    $data["${prefix}\${category}::$name"] = @{ Exists = ($Mixed -and $i -lt 3); Value = @(0, 1, $maximum, 0, 0)[$i] }
  }
  $data | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $File -Encoding UTF8
  return $data
}
function Reset-Values {
  $global:dayanPolicyTestvalues = @{}
  foreach ($name in $names) { $global:dayanPolicyTestvalues[$name] = 1 }
  $global:dayanPolicyTestwrites = 0
  $global:dayanPolicyTestignoreDelete = $false
  $global:dayanPolicyTestfailDelete = $false
  $global:dayanPolicyTestfailRead = $false
}
function Expect-Failure([string]$File) {
  $failed = $false
  try { & $restore -ConfirmRestore -UserSid $sid -BackupPath $File -PassThru | Out-Null } catch { $failed = $true }
  Assert-That $failed 'Expected validation or restoration failure.'
  Assert-That (Test-Path -LiteralPath $File) 'Failed restoration must retain its backup.'
}

$file = Join-Path $TestDirectory 'native.json'
$null = New-Backup $file
Reset-Values
$plan = & $restore -ConfirmRestore -UserSid $sid -BackupPath $file -ValidateOnly
Assert-That ($plan.stage -eq 'validated' -and $plan.policies.Count -eq 5 -and $global:dayanPolicyTestwrites -eq 0) 'Read-only validation failed.'
$result = & $restore -ConfirmRestore -UserSid $sid -BackupPath $file -PassThru
Assert-That ($result.stage -eq 'restored' -and $global:dayanPolicyTestvalues.Count -eq 0 -and -not (Test-Path $file)) ("Native Registry:: backup failed: stage={0}; remaining={1}; backup={2}" -f $result.stage, $global:dayanPolicyTestvalues.Count, (Test-Path $file))
$checks += 'native provider path and read-only validation'

$file = Join-Path $TestDirectory 'legacy.json'
$null = New-Backup $file $true $true
Reset-Values
$null = & $restore -ConfirmRestore -UserSid $sid -BackupPath $file -PassThru
Assert-That ($global:dayanPolicyTestvalues.Count -eq 3 -and $global:dayanPolicyTestvalues.DisableTaskMgr -eq 0 -and $global:dayanPolicyTestvalues.DisableLockWorkstation -eq 1 -and $global:dayanPolicyTestvalues.DisableChangePassword -eq -1) 'Original DWORD values were not preserved.'
$checks += 'legacy HKCU and original zero, one and unsigned DWORD values'

$file = Join-Path $TestDirectory 'native-unsigned.json'
$null = New-Backup $file $false $true
Reset-Values
$null = & $restore -ConfirmRestore -UserSid $sid -BackupPath $file -PassThru
Assert-That ($global:dayanPolicyTestvalues.DisableChangePassword -eq -1) 'Unsigned DWORD restoration failed.'
$checks += 'unsigned DWORD and signed backup compatibility'

foreach ($kind in @('malformed', 'different-user', 'incomplete', 'invalid-value', 'invalid-exists')) {
  $file = Join-Path $TestDirectory ($kind + '.json')
  $data = New-Backup $file
  if ($kind -eq 'malformed') { $data['unexpected'] = @{ Exists = $false } }
  if ($kind -eq 'different-user') { $data = @{}; foreach ($name in $names) { $data["Registry::HKEY_USERS\S-1-5-21-99-99-99-1001\Software\Microsoft\Windows\CurrentVersion\Policies\System::$name"] = @{ Exists = $false } } }
  if ($kind -eq 'incomplete') { $data.Remove(@($data.Keys)[0]) }
  if ($kind -eq 'invalid-value') { $data[@($data.Keys)[4]] = @{ Exists = $true; Value = 'bad' } }
  if ($kind -eq 'invalid-exists') { $data[@($data.Keys)[4]] = @{ Exists = 'false' } }
  $data | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $file -Encoding UTF8
  Reset-Values
  Expect-Failure $file
  Assert-That ($global:dayanPolicyTestwrites -eq 0) 'Invalid backup must be rejected before any write.'
  $checks += $kind
}

foreach ($kind in @('silent-delete-failure', 'access-denied', 'read-denied', 'what-if')) {
  $file = Join-Path $TestDirectory ($kind + '.json')
  $null = New-Backup $file
  Reset-Values
  if ($kind -eq 'silent-delete-failure') { $global:dayanPolicyTestignoreDelete = $true; Expect-Failure $file }
  if ($kind -eq 'access-denied') { $global:dayanPolicyTestfailDelete = $true; Expect-Failure $file }
  if ($kind -eq 'read-denied') { $global:dayanPolicyTestfailRead = $true; Expect-Failure $file; Assert-That ($global:dayanPolicyTestwrites -eq 0) 'A read error must not be treated as an absent value.' }
  if ($kind -eq 'what-if') { & $restore -ConfirmRestore -UserSid $sid -BackupPath $file -WhatIf 6>$null | Out-Null; Assert-That ((Test-Path $file) -and $global:dayanPolicyTestwrites -eq 0) 'WhatIf must retain backup and policies.' }
  $checks += $kind
}

$job = Join-Path $TestDirectory 'job'
[IO.Directory]::CreateDirectory($job) | Out-Null
foreach ($name in @('authorize-dayan.ps1', 'restore-dayan-lockdown.ps1')) { Copy-Item -LiteralPath (Join-Path $scripts $name) -Destination $job }
$filterScript = Join-Path $job 'restore-dayan-keyboard-filter.ps1'
[IO.File]::WriteAllText($filterScript, "throw 'Simulated unavailable Keyboard Filter'")
$null = New-Backup (Join-Path $job 'windows-lockdown-backup.json')
'{}' | Set-Content -LiteralPath (Join-Path $job 'keyboard-filter-backup.json')
Reset-Values
& (Join-Path $job 'authorize-dayan.ps1') -Action restore -UserSid $sid -BackupDirectory $job
$outcome = Get-Content -Raw -LiteralPath (Join-Path $job 'result.json') -Encoding UTF8 | ConvertFrom-Json
Assert-That (-not $outcome.ok -and $global:dayanPolicyTestvalues.Count -eq 0 -and (Test-Path (Join-Path $job 'keyboard-filter-backup.json'))) 'Components must restore independently.'
Assert-That (Test-Path (Join-Path $job 'policy-restoration.json')) 'Partial completion receipt missing.'
[IO.File]::WriteAllText($filterScript, 'param([switch]$ConfirmKeyboardRestore, $UserSid, $BackupPath) Remove-Item -LiteralPath $BackupPath; return @{ stage = ''restored''; secureKeys = @(); settings = @() }')
& (Join-Path $job 'authorize-dayan.ps1') -Action restore -UserSid $sid -BackupDirectory $job
$outcome = Get-Content -Raw -LiteralPath (Join-Path $job 'result.json') -Encoding UTF8 | ConvertFrom-Json
Assert-That ($outcome.ok -and $outcome.policy.policies.Count -eq 5 -and $outcome.filter.stage -eq 'restored') 'Retry must retain the completed registry restoration record.'
$checks += 'independent component restoration and retry receipt'
@{ checks = $checks; count = $checks.Count; realRegistryWrites = 0 } | ConvertTo-Json -Depth 4 -Compress
