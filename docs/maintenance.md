# 换电脑与远程维护

## 换电脑后继续使用

1. 打开公开仓库的 [Releases](https://github.com/jyan5334-lab/dayan-clock/releases)。
2. 下载并安装对应版本的 Windows x64 安装包。
3. 启动后查看设置中的系统版本、架构与策略检测结果。
4. 按需重新选择壁纸、样式和锁屏密码。需要系统策略时，在新电脑设置中重新引导授权。

如果只使用软件，到这里即可。GitHub 不会自动同步本机用户数据。

## 迁移个人设置

完全退出旧电脑上的 DAYAN时钟，另行备份 `%APPDATA%\DAYAN时钟\preferences.json`。在新电脑安装同版本后，先退出程序，再将文件放到同一用户数据位置。

该文件包含密码哈希、窗口位置和本地设置，应按私密文件保管，不要上传到仓库或问题反馈。复制后会保留旧锁屏密码；窗口位置在程序启动时会根据当前屏幕校正。

`windows-lockdown-backup.json` 与旧电脑、旧用户 SID 有关，**只用于原电脑原用户恢复**，不要迁移到新电脑或用于新用户。旧电脑不再作为展示设备时，应先在旧电脑设置中“恢复原有策略”，按系统要求重新登录并验证恢复，再交接设备。

## 获取源码继续开发

```sh
git clone https://github.com/jyan5334-lab/dayan-clock.git
cd dayan-clock
npm ci
npm run check
npm start
```

安装环境见 [部署说明](deployment.md)。在已有副本中，先确认没有未提交修改，再更新：

```sh
git status
git pull --ff-only
npm ci
npm run check
```

用分支保存修改，审查后合并回 `main`。更换维护设备可直接读取公开仓库；提交和发布仍需要 GitHub 写权限。邀请协作者时由仓库所有者在 GitHub 的 Settings → Collaborators 中管理权限。

## 每次推送的文档要求

每次推送都同步更新 `CHANGELOG.md`，说明本次变更、用户能看到的结果以及相关验证。功能或素材发生变化时，同步更新 README 图文介绍、使用说明和对应截图；新增图片应保留原图尺寸、来源与校验信息。不要将未验证的画质、平台或权限能力写成已经通过验收。

正式发布安装包时，另提供 `docs/releases/v<版本>.md`，列出更新内容、下载文件、平台范围、升级步骤、验证范围与已知限制。先完成检查与文档，再推送源码及标签，并在公开 Release 保存安装包、源码 ZIP 和 SHA-256 清单。

## 发布新版本

1. 更新版本号、锁文件、更新记录与版本说明，运行源码检查和桌面验收。
2. 使用 `npm run dist:win` 构建，再对生成的安装程序进行启动与交互检查。
3. 提交源码，创建并推送对应标签。以下以示例版本 `1.3.2` 说明，实际需替换为待发布版本：

```sh
git add .
git commit -m "Release DAYAN Clock 1.3.2"
git tag -a v1.3.2 -m "DAYAN Clock 1.3.2"
git push origin main
git push origin v1.3.2
git archive --format=zip --output=release/DAYANClock-Source-1.3.2.zip v1.3.2
```

4. 在 PowerShell 生成校验清单：

```powershell
$version = '1.3.2'
$names = @("DAYANClock-Setup-$version-x64.exe", "DAYANClock-Source-$version.zip")
$lines = foreach ($name in $names) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path 'release' $name)).Hash.ToLowerInvariant()
    "$hash  $name"
}
$lines | Set-Content -LiteralPath "release/SHA256SUMS-$version.txt" -Encoding ascii
```

5. 在 GitHub Releases 创建草稿，选择对应标签，填写更新内容、平台范围、验收结果和已知限制。
6. 上传安装包、标签源码 ZIP 和 SHA-256 清单，确认后发布。安装包未签名时如实标注。
7. 重新下载并核对 SHA-256，确认 Release 可公开访问，仓库保持 Public。

安装包通过 Release 保存，不加入 Git 历史。依赖由锁文件恢复，不上传 `node_modules`。应用已包含启动检查、强制更新提示、下载校验和重启安装流程；当前公开 GitHub Release 可作为默认更新源，需要自定义渠道时再配置 `DAYAN_UPDATE_MANIFEST_URL`，不能把 GitHub Token 写进客户端。

## 问题排查

反馈时提供软件版本、Windows 版本、系统架构、显示分辨率、缩放比例、复现步骤和不含个人信息的截图。不要附带密码、用户配置文件、令牌或系统策略备份。

仓库问题模板可用于远程维护。Windows 授权问题需区分 UAC 取消、管理员权限不足、公司组策略覆盖和版本不支持；不可把“检测到策略值”直接当成系统级锁定验收成功。
