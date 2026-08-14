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
6. 执行 `pnpm run capture:h5`、`pnpm run validate:review`，更新本地批阅队列。
7. 不自动把素材上传到公开网络，不自动导入 Eagle，等待用户批阅。
