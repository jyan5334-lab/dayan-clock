# DAYAN时钟

用于培训展示、直播计时和桌面屏保的离线桌面工具。打开即显示电脑本地时间，可切换秒表、倒计时和正计时；提供五种数字样式、十张本地壁纸、日期与黄历，以及密码锁定展示模式。

当前版本：**1.3.2**。本仓库为私有代码与安装包备份，供获授权的维护者访问。

[下载安装包](https://github.com/jyan5334-lab/dayan-clock/releases/latest) · [使用说明](docs/user-guide.md) · [部署与构建](docs/deployment.md) · [换电脑与远程维护](docs/maintenance.md) · [更新记录](CHANGELOG.md)

![DAYAN时钟桌面窗口](docs/screenshots/clock.png)

## 功能与界面

| 功能 | 当前行为 |
| --- | --- |
| 时钟 | 默认首页，显示本机时分秒、年月日、农历、节日节气与宜忌 |
| 秒表 | 启动、暂停、继续和重置，显示小数秒 |
| 倒计时 | 设置分钟与秒数，支持暂停、继续和归零 |
| 正计时 | 从零累计，支持暂停、继续和重置 |
| 五种样式 | 霓虹矩阵、液态铬金、机械黑曜、量子光环、赛博终端 |
| 十张壁纸 | 全部随安装包提供，断网可用；当前为静态图片 |
| 窗口与全屏 | 四角等比例缩放、置顶、全屏适配、顶部栏随鼠标移动暂时显示 |
| 密码锁定 | 4 至 16 位数字密码；锁定后进入 kiosk 全屏，隐藏操作入口 |
| Windows 设置 | 启动自检、版本架构识别、一键引导授权、策略复检与恢复 |
| 本地保存 | 保存样式、背景、倒计时目标、暂停计时值和窗口设置 |

### 倒计时

![倒计时展示](docs/screenshots/countdown.png)

### 全屏与黄历

全屏按屏幕实际宽高布局；普通窗口保持比例。停止移动鼠标后，顶部栏自动隐藏。黄历在本地计算，不需要联网。

![全屏时钟与黄历](docs/screenshots/fullscreen.png)

### 系统自检与引导授权

顶部“设置”始终是未锁定状态下的入口。安装或从旧版升级后首次启动自动打开设置；每次启动仍会检测系统与策略。以下截图为实际运行界面。

![Windows 自检和一键引导授权](docs/screenshots/settings-800.png)

### 壁纸预览

| 暗夜山峦 | 寂静月面 |
| --- | --- |
| ![暗夜山峦](assets/backgrounds/mountains.webp) | ![寂静月面](assets/backgrounds/lunar.webp) |
| 午夜海潮 | 混凝土秘境 |
| ![午夜海潮](assets/backgrounds/ocean.webp) | ![混凝土秘境](assets/backgrounds/vault.webp) |
| 熔岩余烬 | 雨后深林 |
| ![熔岩余烬](assets/backgrounds/basalt.webp) | ![雨后深林](assets/backgrounds/forest.webp) |
| 绯红绸幕 | 冰晶棱镜 |
| ![绯红绸幕](assets/backgrounds/silk.webp) | ![冰晶棱镜](assets/backgrounds/crystal.webp) |
| 银月沙丘 | 雨夜都市 |
| ![银月沙丘](assets/backgrounds/dunes.webp) | ![雨夜都市](assets/backgrounds/city.webp) |

## 安装要求

| 项目 | 要求或范围 |
| --- | --- |
| 已提供安装包 | Windows 10 / Windows 11，x64 |
| 使用时依赖 | 无需 Node.js、浏览器插件或服务器 |
| 网络 | 安装、运行与本地黄历不依赖网络；下载和维护代码需要网络 |
| 管理员权限 | 日常运行不申请管理员；修改 Windows 策略时由用户批准 UAC |
| 实机验证 | Windows 11 专业版 x64；Windows 10 尚未实机验收 |
| 其他平台 | Windows 12 等未来版本及 ARM64 授权未验证；macOS 仅预留构建配置 |

1. 登录有本仓库访问权限的 GitHub 账号，打开 [Releases](https://github.com/jyan5334-lab/dayan-clock/releases)。
2. 下载 `DAYANClock-Setup-1.3.2-x64.exe`，运行后选择安装目录。
3. 从桌面或开始菜单启动，首次打开可在设置中确认系统版本与策略状态。
4. 核对设置页中的软件版本。升级时先退出旧程序，再运行新安装包。

安装包当前未做 Windows 代码签名，系统可能显示“未知发布者”。每个版本附带 `SHA256SUMS-1.3.2.txt`，校验方法见 [部署说明](docs/deployment.md#安装包校验)。

## 开发与构建

建议使用 Windows x64、Git 和 Node.js 24（含 npm）；本次构建使用 Node.js 24.19.0。依赖版本由 `package-lock.json` 锁定，首次安装依赖与下载打包工具需要网络。

```sh
git clone https://github.com/jyan5334-lab/dayan-clock.git
cd dayan-clock
npm ci
npm run check
npm start
```

生成 Windows x64 安装包：

```sh
npm run dist:win
```

输出在本机 `release/`。该目录不进入 Git 历史，正式安装包和源码压缩包通过 GitHub Release 保存。`npm run check` 检查源码语法、资源与文档链接，不代替实际桌面交互验收。

macOS 需在 Mac 或 macOS 构建环境执行 `npm ci` 和 `npm run dist:mac`。当前未交付或验证 Mac 安装包；正式分发需要另行配置签名和公证。详见 [部署与构建](docs/deployment.md)。

## 源码结构

```text
desktop/           Electron 主进程、IPC、窗口缩放和 Windows 打包
renderer/          计时逻辑、样式、背景列表、黄历与桌面交互
assets/            十张壁纸、应用图标和第三方许可证
scripts/           Windows 策略授权/恢复，以及原始素材工具
tools/             可在新电脑直接运行的源码检查
docs/              使用、部署、维护、验收与版本说明
.github/           问题反馈模板
index.html         应用入口
package-lock.json  固定依赖版本
```

## 锁屏与数据

应用密码保存在本机用户目录中，采用加盐 PBKDF2 哈希；不读取或更改 Windows 登录密码。`Ctrl+Alt+Delete` 是 Windows 安全界面，普通桌面程序不能拦截。一键引导授权配置的是当前用户的五项策略，**策略在解锁和退出程序后仍然保留**，可在设置中恢复；读取到“策略已配置”不等于完成设备级安全验收。详见 [Windows 锁定说明](docs/windows-kiosk.md)。

本地设置默认位于 `%APPDATA%\DAYAN时钟\preferences.json`，卸载时保留。GitHub 保存程序和素材，不会自动备份个人设置、密码或系统策略。换电脑时按 [迁移说明](docs/maintenance.md) 操作，旧电脑的策略备份不可在新电脑还原。

动态壁纸当前尚未作为产品功能交付，媒体层已为后续扩展预留。代码与原始素材为私有项目内容，见 [许可说明](LICENSE)；第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
