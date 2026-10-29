# DAYAN桌面

用于培训展示、直播计时和桌面屏保的离线桌面工具。打开即显示电脑本地时间，可切换秒表、倒计时和正计时；提供十四种显示样式、二十张本地壁纸、日期与黄历，以及密码锁定展示模式。

当前版本：**1.6.4**。本仓库与 Release 已设为公开，代码、素材、文档和 Windows 安装包可直接访问。

[下载安装包](https://github.com/jyan5334-lab/dayan-clock/releases/latest) · [使用说明](docs/user-guide.md) · [部署与构建](docs/deployment.md) · [换电脑与远程维护](docs/maintenance.md) · [更新记录](CHANGELOG.md)

![DAYAN桌面窗口](docs/screenshots/clock.png)

## 功能与界面

| 功能 | 当前行为 |
| --- | --- |
| 时钟 | 默认首页，显示本机时分秒、年月日、星期、农历、节日节气与宜忌 |
| 秒表 | 启动、暂停、继续和重置，显示小数秒 |
| 倒计时 | 设置分钟与秒数，支持暂停、继续和归零 |
| 正计时 | 从零累计，支持暂停、继续和重置 |
| 经典样式 | 霓虹矩阵、液态铬金、机械黑曜、量子光环、赛博终端 |
| 新增九款 | 巨幕极简、星舰中枢、星尘聚时、电路脉冲、故障电压、酸性涂鸦、光速轨迹、三体星轨、光谱脉冲 |
| 二十张壁纸 | 保留原有十张，新增十个主题；全部本地提供，断网可用，当前为静态图片 |
| 窗口与全屏 | 四角等比例缩放、置顶、全屏适配、顶部栏随鼠标移动暂时显示 |
| 密码锁定 | 4 至 16 位数字密码；锁定后进入 kiosk 全屏，隐藏操作入口 |
| Windows 设置 | 启动自检、版本架构识别、一键引导授权、策略复检与恢复 |
| 设置菜单 | 一键授权、显示设置、开机自启动、关于我们和窗口层级 |
| 更新检查 | 启动时检查版本；发现可用更新后进入不可取消的下载更新流程 |
| 本地保存 | 保存样式、背景、倒计时目标、暂停计时值、显示偏好、开机自启动和窗口设置 |

### 新增样式

点击顶部调色盘，在“新增样式”中选择。九款样式均支持时钟、秒表、倒计时与正计时，切换样式不会重置正在运行的计时。

| 巨幕极简 | 星尘聚时 | 光谱脉冲 |
| --- | --- | --- |
| ![巨幕极简](docs/screenshots/giant.png) | ![星尘聚时](docs/screenshots/stardust.png) | ![光谱脉冲](docs/screenshots/spectrum.png) |

### 倒计时

![倒计时展示](docs/screenshots/countdown.png)

### 全屏与黄历

全屏按屏幕实际宽高布局；普通窗口保持比例。停止移动鼠标后，顶部栏自动隐藏。日期显示星期，黄历在本地计算，不需要联网；是否显示黄历及右上角四种模式文字可在设置中分别控制。

![全屏时钟与黄历](docs/screenshots/fullscreen.png)

### 设置菜单与更新

顶部“设置”始终是未锁定状态下的入口，菜单包含“一键授权”“显示设置”“开机自启动”“关于我们”和“窗口层级”。安装或从旧版升级后首次启动自动打开设置；每次启动仍会检测系统与策略。关于我们中标注归属公司为昆明迅琰网络科技有限公司。

启动时会检查更新；发现新版本后只允许执行“确定更新”。程序保留四连接并行下载，完成校验后等待安装辅助程序就绪，再退出旧版本、显示安装进度并重启。安装失败会保留安装包和日志，尝试重新打开原程序。需要使用自有镜像或受控更新渠道时，可配置 `DAYAN_UPDATE_MANIFEST_URL`；不能把 GitHub Token 直接写进安装包。

**1.6.2 / 1.6.3 用户升级提示：** 旧版安装交接可能在下载完成后直接退出。请手动下载并安装 1.6.4 一次；新辅助程序安装后，后续更新才会使用修复后的交接流程。

![Windows 自检和一键引导授权](docs/screenshots/settings-800.png)

### 壁纸预览

右下角图片按钮可选择全部二十张壁纸；选择面板支持滚动，小窗口也可访问完整列表。最新十张 PNG 原图实测为 **1672×941**，采用居中等比例覆盖，**不属于原生 4K / 8K 壁纸**。屏幕尺寸适配与图片原生清晰度是两回事。完整主题、分辨率与生成来源见 [壁纸说明](docs/wallpapers.md)。

![月下花庭壁纸与时钟的实际程序效果](docs/screenshots/wallpaper-floral.png)

#### 新增十个主题

| 银河穹顶 | 钛银机库 |
| --- | --- |
| ![银河穹顶](assets/backgrounds/galactic-vault.png) | ![钛银机库](assets/backgrounds/titanium-hangar.png) |
| 深海遗迹 | 极夜雪境 |
| ![深海遗迹](assets/backgrounds/abyssal-sanctuary.png) | ![极夜雪境](assets/backgrounds/polar-silence.png) |
| 翡翠秘境 | 玫瑰星纱 |
| ![翡翠秘境](assets/backgrounds/emerald-sanctuary.png) | ![玫瑰星纱](assets/backgrounds/rose-silk.png) |
| 月下花庭 | 流光琉璃 |
| ![月下花庭](assets/backgrounds/moonlit-garden.png) | ![流光琉璃](assets/backgrounds/prismatic-glass.png) |
| 金曜沙海 | 雨夜霓城 |
| ![金曜沙海](assets/backgrounds/obsidian-dunes.png) | ![雨夜霓城](assets/backgrounds/neon-rain.png) |

#### 原有十张

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
2. 下载 `DAYANClock-Setup-1.6.1-x64.exe`，运行后选择安装目录。
3. 从桌面或开始菜单启动，首次打开可在设置中确认系统版本与策略状态。
4. 核对设置页中的软件版本。升级时先退出旧程序，再运行新安装包。

安装包当前未做 Windows 代码签名，系统可能显示“未知发布者”。每个版本附带 `SHA256SUMS-1.6.1.txt`，校验方法见 [部署说明](docs/deployment.md#安装包校验)。

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
assets/            二十张壁纸、素材清单、应用图标和第三方许可证
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

动态壁纸当前尚未作为产品功能交付，媒体层已为后续扩展预留。代码与原始素材随公开仓库维护，使用范围见 [许可说明](LICENSE)；第三方组件见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
