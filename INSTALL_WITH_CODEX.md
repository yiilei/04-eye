# 交给 Codex 的安装说明

把本仓库链接发给 Codex，并输入：

```text
请安装并配置“04的眼”。先检查我的 Mac 芯片，安装 GitHub Release 中对应的应用；然后引导我在 Codex 内置浏览器登录小红书，检测 Eagle 是否启动。完成后，帮我抓取最新的小红书创作服务活动。
```

Codex 应按以下顺序操作：

1. 下载并安装“04的眼.app”。
2. 打开应用，确认独立桌面窗口可以启动。
3. 打开小红书并等待用户扫码登录；禁止索取或复制 Cookie。
4. 检查 Eagle 本地 API；未安装时允许跳过。
5. 读取 `data/xhs-account-pins.json` 和 `data/xhs-media-policy.json`。
6. 同时读取 `~/Library/Application Support/04的眼/data/user-preferences.json`；如果文件存在，以里面的抓取时间、推送时间和用户选中的埋点为准。
7. 执行 `pnpm run capture:h5` 或 `pnpm run capture:xhs`，然后执行 `pnpm run validate:review`。不要再把素材复制回网站静态目录。
8. 确认素材写入 `~/Library/Application Support/04的眼/review/`，应用应在 2 秒内自动显示新增批阅内容。
9. 不自动把素材上传到公开网络，不自动导入 Eagle，等待用户批阅。用户点 YES 后由应用导入 Eagle；点 NO 后进入本地可恢复回收区。

## 验收标准

- 应用首次无素材时显示三步设置页。
- 抓取完成后无需刷新，自动进入批阅页。
- 图片、视频与 Live Photo 使用本地文件，不依赖会过期的远程链接。
- NO 后素材目录移动到 `~/Library/Application Support/04的眼/trash/`。
- 紧接着按 `Command + Z`，素材和批阅条目都能恢复。
- YES 时 Eagle 未启动会显示明确提示；Eagle 已启动则自动创建/使用“小红书”文件夹并复核图片尺寸。
