param([ValidateSet('enable','restore')][string]$Action, [string]$UserSid, [string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
$resultPath = Join-Path $PSScriptRoot 'result.json'
try {
  $policyBackup = Join-Path $BackupDirectory 'windows-lockdown-backup.json'
  $filterBackup = Join-Path $BackupDirectory 'keyboard-filter-backup.json'
  $receiptPath = Join-Path $BackupDirectory 'policy-restoration.json'
  if ($Action -eq 'enable') {
    if (Test-Path -LiteralPath $receiptPath) { Remove-Item -LiteralPath $receiptPath -Force }
    & (Join-Path $PSScriptRoot 'enable-dayan-lockdown.ps1') -ConfirmLockdown -UserSid $UserSid -BackupPath $policyBackup | Out-Null
    $filter = & (Join-Path $PSScriptRoot 'enable-dayan-keyboard-filter.ps1') -ConfirmKeyboardFilter -UserSid $UserSid -BackupPath $filterBackup
  } else {
    # Restore each owned policy set independently. A missing or unsupported
    # Keyboard Filter must not prevent the registry policies from being restored.
    $errors = @()
    $filter = $null
    $policy = $null
    if (Test-Path -LiteralPath $receiptPath) {
      $receipt = Get-Content -Raw -LiteralPath $receiptPath -Encoding UTF8 | ConvertFrom-Json
      if ($receipt.version -ne 1) { throw 'Unsupported policy restoration record.' }
      $policy = $receipt.policy
      $filter = $receipt.filter
    }
    if (Test-Path -LiteralPath $filterBackup) {
      try { $filter = & (Join-Path $PSScriptRoot 'restore-dayan-keyboard-filter.ps1') -ConfirmKeyboardRestore -UserSid $UserSid -BackupPath $filterBackup }
      catch { $errors += "Keyboard Filter: $($_.Exception.Message)" }
    }
    if (Test-Path -LiteralPath $policyBackup) {
      try { $policy = & (Join-Path $PSScriptRoot 'restore-dayan-lockdown.ps1') -ConfirmRestore -UserSid $UserSid -BackupPath $policyBackup -PassThru }
      catch { $errors += "Windows 策略: $($_.Exception.Message)" }
    }
    # Persist completed components so retries and app restarts can verify them.
    if ($null -ne $policy -or $null -ne $filter) {
      @{ version = 1; at = [DateTime]::UtcNow.ToString('o'); policy = $policy; filter = $filter } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath ($receiptPath + '.tmp') -Encoding UTF8
      Move-Item -LiteralPath ($receiptPath + '.tmp') -Destination $receiptPath -Force
    }
    if ($errors.Count -gt 0) { throw ($errors -join '; ') }
  }
  @{ ok = $true; filter = $filter; policy = $policy } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
} catch {
  @{ ok = $false; error = $_.Exception.Message; filter = $filter; policy = $policy } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  exit 1
}
