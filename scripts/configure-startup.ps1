param(
  [Parameter(Mandatory=$true)][string]$Executable,
  [Parameter(Mandatory=$true)][ValidateSet('enable','disable')][string]$Action,
  [ValidatePattern('^[A-Za-z-]{0,32}$')][string]$TaskNameSuffix = ''
)
$ErrorActionPreference = 'Stop'
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $taskName = 'DAYANDesktop-' + $identity.User.Value + $TaskNameSuffix
  $scheduler = New-Object -ComObject 'Schedule.Service'
  $scheduler.Connect()
  $folder = $scheduler.GetFolder('\')
  $existing = $null
  try { $existing = $folder.GetTask($taskName) } catch {
    if ($_.Exception.HResult -ne -2147024894) { throw }
  }
  if ($Action -eq 'disable') {
    if ($null -ne $existing) { $folder.DeleteTask($taskName, 0) }
  } else {
    $definition = $scheduler.NewTask(0)
    $definition.RegistrationInfo.Description = 'DAYAN desktop: start the last saved wallpaper at user sign-in.'
    $definition.Principal.UserId = $identity.User.Value
    $definition.Principal.LogonType = 3
    $definition.Principal.RunLevel = 0
    $definition.Settings.Enabled = $true
    $definition.Settings.StartWhenAvailable = $true
    $definition.Settings.DisallowStartIfOnBatteries = $false
    $definition.Settings.StopIfGoingOnBatteries = $false
    $definition.Settings.ExecutionTimeLimit = 'PT0S'
    $definition.Settings.MultipleInstances = 2
    $trigger = $definition.Triggers.Create(9)
    $trigger.UserId = $identity.User.Value
    $trigger.Enabled = $true
    $command = $definition.Actions.Create(0)
    $command.Path = $Executable
    $command.Arguments = '--dayan-login-start'
    $command.WorkingDirectory = [System.IO.Path]::GetDirectoryName($Executable)
    $null = $folder.RegisterTaskDefinition($taskName, $definition, 6, $identity.User.Value, $null, 3, $null)
  }
  @{ok=$true;mode='logon-task'} | ConvertTo-Json -Compress
} catch {
  @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress
  exit 1
}
