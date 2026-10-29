# 部署与构建

## 直接安装

下载公开仓库 [Releases](https://github.com/jyan5334-lab/dayan-clock/releases) 中的 Windows x64 安装包。使用者无需安装开发环境、Node.js 或服务器。程序运行、壁纸与黄历均为本地资源。

已提供 Windows 10/11 x64 安装包，实机验收环境为 Windows 11 专业版 x64。Windows 10 尚未实机验收，Windows ARM64、未来 Windows 版本的一键授权尚未验证；macOS 尚无已验证安装包。设置中的兼容性提示描述应用当前允许的授权范围，不是所有系统版本的认证。

双击安装包，选择安装位置并完成安装。升级前退出旧程序；设置页显示正在运行的版本。卸载默认保留用户设置。安装程序和普通启动不自动修改 Windows 策略；只有在用户选择授权并批准 UAC 后才尝试配置。

## 安装包校验

同一 Release 下载 `SHA256SUMS-1.6.8.txt` 与安装包，在下载目录运行：

```powershell
Get-FileHash -Algorithm SHA256 .\DAYANClock-Setup-1.6.8-x64.exe
Get-FileHash -Algorithm SHA256 .\DAYANClock-Source-1.6.8.zip
```

将输出与校验文件逐项比较。安装包暂未签名，可能出现未知发布者提示；校验值用于确认文件与该版本资产一致，不代替代码签名。

## 开发环境

建议 Windows x64、Git、Node.js 24 和随 Node.js 安装的 npm。本次使用 Node.js 24.19.0、Electron 45.0.0、electron-builder 26.18.0。`.nvmrc` 标记 Node.js 主版本，实际依赖以 `package-lock.json` 为准。

```sh
git clone https://github.com/jyan5334-lab/dayan-clock.git
cd dayan-clock
npm ci
npm run check
npm run test:update-install
npm start
```

公开仓库可直接克隆和下载；提交代码、创建 Release 等维护操作仍需要对应的 GitHub 写权限。不要把访问令牌写入克隆地址、源码或脚本。首次 `npm ci` 和 Windows 打包需要从依赖源下载 Electron、NSIS 等工具，请确保网络可访问。

## Windows 打包

```sh
npm run pack:win
npm run dist:win
```

第一条生成 `release/win-unpacked/`，第二条通过项目的 Windows 构建入口生成 `release/DAYANClock-Setup-<版本>-x64.exe`。`dist:win` 已包含当前项目的 NSIS 卸载程序处理，正式打包请使用这个脚本。

Windows 启动与打包入口使用系统 Windows PowerShell 和 .NET 编译 `desktop/update-host.cs`，生成独立的更新辅助程序。`assets/DAYANUpdateHost.exe` 是构建产物，不提交到 Git；源码 ZIP 解压后按上述命令可重新生成。使用者安装后无需另行编译或配置。

同一步骤还会编译 `desktop/desktop-host.cs`，生成 `assets/DAYANDesktopHost.exe`。它负责桌面图标层下方的原生窗口挂接，也不提交到 Git。可选的 `npm run test:desktop-shell` 需要已安装的 Playwright，或通过 `DAYAN_PLAYWRIGHT_MODULE` 指定其模块路径；它会在独立测试数据下检查真实桌面图标层和右键菜单，不操作桌面文件。

Windows 构建还会编译 `desktop/keyboard-guard.cs`，生成 `assets/DAYANKeyboardGuard.exe`，该文件只随安装包发布。它通过 Windows 自带的 .NET Framework 和 Windows Forms 消息循环，在应用锁定期间拦截普通桌面的按键。`npm run test:keyboard` 使用独立测试数据和带标记的 Windows 原生输入，验证拦截、数字密码和异常释放；测试期间会短暂占用键盘，不修改系统策略，不保存用户按键。系统安全桌面及不同 Windows 权限级别的行为仍需要目标设备验收。

不要把 `node_modules/`、`release/`、本机数据或证书提交到 Git。无需把已安装软件目录复制回源码。原始图标和壁纸已提交，普通构建不需要重新生成。

`scripts/create-icon.cjs` 是可选的素材重制工具，另需 Playwright、Sharp 和 Chrome；它不参与 `npm ci`、启动或打包。`scripts/import-preview.cjs` 是早期预览导入工具，不要对当前维护中的渲染文件重复运行。

## macOS 构建

源码预留 Intel 与 Apple Silicon 的 DMG / ZIP 配置。在 macOS 构建环境运行：

```sh
npm ci
npm run dist:mac
```

当前版本未在 Mac 构建或验证，Windows 专属策略不能移植到 macOS。正式分发需由维护者在构建环境配置 Apple 签名、公证和对应凭据，凭据不要进入仓库。当前 Release 只包含 Windows 安装包。

## 验收与发布

先运行 `npm run check`，再按 [桌面验收清单](verification.md) 在开发模式与实际打包程序中检查。需要写入系统策略的测试应在专用测试用户或虚拟机执行，确认可以恢复。

更新版本时同步 `package.json`、`package-lock.json` 与 `CHANGELOG.md`，提交后创建对应 `v<版本>` 标签。将安装包、从标签导出的源码 ZIP 和 SHA-256 文件上传至该标签的 Release，核对资产完整后发布。详细步骤见 [维护说明](maintenance.md#发布新版本)。

本仓库还提供 `node tools/prepare-release.cjs`，在构建、验收并提交源码后生成源码 ZIP、公开更新清单 `update.json` 和校验文件。维护者可使用 `node tools/publish-release.cjs status|source|upload|publish|verify` 分步检查、同步源码、上传草稿、发布与复核；脚本使用本机 Git 凭据，不在客户端内置维护令牌，源码同步会核对远端基线并拒绝覆盖其他提交。

## 自动更新

启动时由 Electron 主进程检查 GitHub Release API 和 Release 的 `update.json`；设置 `DAYAN_UPDATE_MANIFEST_URL` 时使用指定清单。Release 数据需包含 `tag_name`、匹配版本的 `DAYANClock-Setup-<版本>-x64.exe` 资产及 SHA-256 摘要。自定义清单格式为 `{"version":"1.6.8","downloadUrl":"https://.../DAYANClock-Setup-1.6.8-x64.exe","size":123456789,"mirrorUrls":["https://自有镜像/..."],"sha256":"64位十六进制摘要","notes":"更新说明"}`。没有有效摘要会拒绝下载。发现更高版本后，程序只显示“确定更新”，下载、校验并重启安装。

当前仓库为 Public，普通安装包可以匿名访问 GitHub API 和 Release 资产。下载前探测直连、系统代理/PAC 及可信镜像，选择可用线路后维持四连接、2 MB 分段下载。完整分段及各自摘要保存在用户数据目录的 `updates/downloads`，重试和程序重开后复检续传；最终安装包必须通过发布清单的 SHA-256 验证。GitHub Token 只发送给 API 域名，不转交 CDN 或镜像。

跨境链路不能仅靠客户端保证稳定速度。发布方应将安装包同步到自己控制的国内对象存储或 CDN，在可信清单的 `mirrorUrls` 中填写 HTTPS 地址，并同步正确的大小和 SHA-256。没有部署的地址不能填写，不使用未知公共下载代理。`DAYAN_GITHUB_TOKEN` 只适合受控内部环境，不编译进客户端。
