param([Parameter(Mandatory = $true)][string]$RequestPath)

$ErrorActionPreference = 'Stop'
$encoding = New-Object System.Text.UTF8Encoding($false)
$jobDir = Split-Path -Parent $RequestPath
$statusPath = Join-Path $jobDir 'status.json'
$logPath = Join-Path $jobDir 'install.log'
$request = $null
$parentExited = $false

function Write-UpdateStatus([string]$stage, [string]$message) {
  $record = @{ stage = $stage; message = $message; time = [DateTime]::UtcNow.ToString('o') }
  [System.IO.File]::AppendAllText($logPath, ($record | ConvertTo-Json -Compress) + [Environment]::NewLine, $encoding)
  $temporary = $statusPath + '.tmp'
  [System.IO.File]::WriteAllText($temporary, ($record | ConvertTo-Json -Compress), $encoding)
  Move-Item -LiteralPath $temporary -Destination $statusPath -Force
}

try {
  $request = [System.IO.File]::ReadAllText($RequestPath, $encoding) | ConvertFrom-Json
  if (-not (Test-Path -LiteralPath $request.installerPath -PathType Leaf)) { throw 'Installer file is missing.' }
  if (-not (Test-Path -LiteralPath $request.appPath -PathType Leaf)) { throw 'Installed application path is missing.' }
  if ($request.version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update version.' }
  $installDir = Split-Path -Parent $request.appPath
  $oldProcess = Get-Process -Id ([int]$request.parentPid) -ErrorAction SilentlyContinue
  if ($null -eq $oldProcess) { throw 'The running application is no longer available for handoff.' }
  Write-UpdateStatus 'ready' 'Helper ready; waiting for the application to exit.'
  if (-not $oldProcess.WaitForExit(60000)) { throw 'The running application did not exit within 60 seconds.' }
  $parentExited = $true
  Write-UpdateStatus 'installing' ('Starting installer: ' + $request.installerPath)
  # NSIS requires /D to be the final argument, without quotes around its value.
  $installerArgs = '--updated'
  if ($request.silent) { $installerArgs += ' /S' }
  $installerArgs += ' /D=' + $installDir
  $installer = Start-Process -FilePath $request.installerPath -ArgumentList $installerArgs -WorkingDirectory $jobDir -WindowStyle Normal -Wait -PassThru
  $installer.Refresh()
  Write-UpdateStatus 'installed' ('Installer exit code: ' + $installer.ExitCode)
  if ($installer.ExitCode -ne 0) { throw ('Installer did not finish successfully. Exit code: ' + $installer.ExitCode) }
  if (-not (Test-Path -LiteralPath $request.appPath -PathType Leaf)) { throw 'Installed executable was not found.' }
  $installedVersion = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($request.appPath).FileVersion
  $actual = [version]$installedVersion
  $expected = [version]$request.version
  if ($actual.Major -ne $expected.Major -or $actual.Minor -ne $expected.Minor -or $actual.Build -ne $expected.Build) { throw ('Installed version mismatch: ' + $installedVersion) }
  Write-UpdateStatus 'restarting' ('Starting application version ' + $installedVersion)
  $restarted = Start-Process -FilePath $request.appPath -ArgumentList '--updated' -WorkingDirectory $installDir -WindowStyle Normal -PassThru
  Start-Sleep -Milliseconds 2000
  $restarted.Refresh()
  if ($restarted.HasExited) {
    $existing = Get-CimInstance Win32_Process -Filter "Name='$([System.IO.Path]::GetFileName($request.appPath))'" | Where-Object { $_.ExecutablePath -eq $request.appPath }
    if ($null -eq $existing) { throw 'The updated application exited before startup completed.' }
  }
  Write-UpdateStatus 'completed' 'Installation completed and application restart confirmed.'
  exit 0
} catch {
  $failure = $_.Exception.Message
  Write-UpdateStatus 'failed' $failure
  if ($parentExited -and $null -ne $request -and (Test-Path -LiteralPath $request.appPath -PathType Leaf)) {
    try {
      Start-Process -FilePath $request.appPath -ArgumentList '--dayan-update-recovery' -WorkingDirectory (Split-Path -Parent $request.appPath) -WindowStyle Normal | Out-Null
    } catch { [System.IO.File]::AppendAllText($logPath, $_.Exception.Message, $encoding) }
  }
  if ($null -ne $request -and $request.notifyOnFailure) {
    try {
      Add-Type -AssemblyName System.Windows.Forms
      $message = "DAYAN桌面更新未完成，已尝试重新打开程序。用户设置与下载的安装包已保留，可双击安装包继续安装。`r`n`r`n" + $failure + "`r`n`r`n安装包：" + $request.installerPath + "`r`n日志：" + $logPath
      [System.Windows.Forms.MessageBox]::Show($message, 'DAYAN桌面更新', 'OK', 'Warning') | Out-Null
    } catch {}
  }
  exit 1
}
