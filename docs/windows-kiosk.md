# Windows 设备级锁定

DAYAN 的应用锁可以强制进入 Electron kiosk 全屏。Windows 版本在锁定期间使用原生低层键盘钩子拦截普通桌面的键盘输入，包括单独的 Win 键；密码框打开后仅将数字、退格和回车交给密码框。解锁时移除钩子，保护进程异常或失去应用心跳约 4 秒后自动释放。该进程不常驻监听未锁定时的键盘，不保存按键记录。

普通桌面程序无法接收或拦截 Windows 的 `Ctrl+Alt+Delete` 安全注意序列，也无法单独阻止任务管理器进程。该功能不替代 Windows 登录锁屏或受信任的系统键盘筛选器，不能承诺屏蔽所有系统、硬件和安全桌面入口。更严格的设备隔离应使用专用标准 Windows 用户并配合受支持版本的系统配置。参考 [Microsoft Keyboard Filter](https://learn.microsoft.com/en-us/windows/configuration/keyboard-filter/)。

## Windows Pro

DAYAN 启动时检测当前 Windows 用户的锁屏策略。顶部“设置”是固定入口，已有密码时同样可以使用。首次安装或从旧版升级后会自动打开一次；未自动打开时可手动点击顶部“设置”。设置显示 Windows 版本、架构、软件版本、检测时间及策略明细，提供“重新检测”“一键引导授权”和“恢复原有策略”。

一键授权适配范围为 Windows 10/11 x64，需要管理员批准且系统策略允许。Windows 12、更高版本、ARM64 和其他未验证平台会停用授权按钮。设置页始终在授权按钮上方显示适配范围。Windows 名称优先通过 Win32_OperatingSystem 读取，避免只依赖可能保留旧名称的注册表 ProductName。

点击“一键引导授权”后，由用户批准 Windows UAC；标准用户可能需要管理员凭据。脚本针对当前应用用户 SID 写入，不会切换到批准 UAC 的管理员账户。授权后自动重新读取五项策略；读取失败、授权取消和系统未适配会分别提示。软件不会自动点击系统授权提示，也不会因为读取策略失败而宣称授权成功。

“策略已配置”只代表注册表中已存在五项限制值，部分限制需重新登录生效，仍应在目标展示账户测试。它不能证明系统无法被绕过，也不能阻止 Ctrl+Alt+Delete 安全界面本身出现。策略在时钟解锁、退出后持续保留，只有执行恢复或管理员修改策略才撤销。

如果需要手动恢复或排查，也可以在专用 kiosk 用户中打开 PowerShell，执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\enable-dayan-lockdown.ps1 -ConfirmLockdown
```

脚本会备份目标登录用户的相关策略，然后配置任务管理器、锁定工作站、修改密码、常用 Windows 快捷键和注销入口限制。重复授权保留首次备份。可在顶部“设置”中选择“恢复原有策略”，也可以手动执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\restore-dayan-lockdown.ps1 -ConfirmRestore
```

修改后注销并重新登录该 kiosk 用户。管理员账户应保留独立的恢复入口，不能把日常管理员账号直接作为展示账号。

## Windows Enterprise / Education

桌面程序可以进一步使用 Windows Shell Launcher，把 DAYAN 设置成该 kiosk 用户登录后的 shell。Shell Launcher 会替换 Explorer shell，适合桌面程序；配置和退出需要由管理员完成。Windows Assigned Access 的单应用模式主要用于 UWP 或 Microsoft Edge，不能直接把当前 Electron 安装包当成普通 Assigned Access 单应用。

Windows 策略属于设备级配置，DAYAN 安装器不会自动修改。应用锁密码仍然由 DAYAN 管理，Windows 策略只负责阻止用户绕过应用进入任务管理器或桌面。
