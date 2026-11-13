!macro customUnInstall
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\scripts\configure-startup.ps1" -Executable "$INSTDIR\DAYANClock.exe" -Action disable'
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.dayan.clock"
!macroend
