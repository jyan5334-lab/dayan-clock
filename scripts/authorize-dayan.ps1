param([ValidateSet('enable','restore')][string]$Action, [string]$UserSid, [string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$resultPath = Join-Path $PSScriptRoot 'result.json'
try {
  $policyBackup = Join-Path $BackupDirectory 'windows-lockdown-backup.json'
  $filterBackup = Join-Path $BackupDirectory 'keyboard-filter-backup.json'
  if ($Action -eq 'enable') {
    & (Join-Path $PSScriptRoot 'enable-dayan-lockdown.ps1') -ConfirmLockdown -UserSid $UserSid -BackupPath $policyBackup | Out-Null
    $filter = & (Join-Path $PSScriptRoot 'enable-dayan-keyboard-filter.ps1') -ConfirmKeyboardFilter -UserSid $UserSid -BackupPath $filterBackup
  } else {
    # Restore each owned policy set independently. A missing or unsupported
    # Keyboard Filter must not prevent the registry policies from being restored.
    $errors = @()
    $filter = $null
    if (Test-Path -LiteralPath $filterBackup) {
      try { $filter = & (Join-Path $PSScriptRoot 'restore-dayan-keyboard-filter.ps1') -ConfirmKeyboardRestore -UserSid $UserSid -BackupPath $filterBackup }
      catch { $errors += "Keyboard Filter: $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath $policyBackup) {
      try { & (Join-Path $PSScriptRoot 'restore-dayan-lockdown.ps1') -ConfirmRestore -UserSid $UserSid -BackupPath $policyBackup | Out-Null }
      catch { $errors += "Windows 策略: $($_.Exception.Message)" }
    }
    if ($errors.Count -gt 0) { throw ($errors -join '; ') }
  }
  @{ ok = $true; filter = $filter } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
  exit 1
}
