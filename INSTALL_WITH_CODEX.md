# 交给 Codex 的安装说明

把本仓库链接发给 Codex，并输入：

```text
请安装并配置“采光”。先检查我的 Mac 芯片，安装 GitHub Release 中对应的应用和源码依赖；确认我已在 Chrome 登录小红书并同意同步后，运行 pnpm xhs:login，把会话同步到采光本机资料目录，并检测 Eagle 是否启动。完成后，帮我抓取最新的小红书创作服务活动。
```

Codex 应按以下顺序操作：

> 仓库安装必须以 `origin/main` 为准。不要把 `FETCH_HEAD` 或 `backup-*` 分支当成最新版；当前目录非空时，应在独立子目录安装，不要覆盖 IDE 自己生成的文件。

1. 下载并安装“采光.app”。
2. 打开应用，确认独立桌面窗口可以启动。
3. 在源码目录执行 `plugins/caiguang/scripts/caiguang setup`。普通使用者只安装 MCP 与脚本运行依赖，不下载 Electron、Vite 等开发工具；需要修改或重新打包应用时才执行 `plugins/caiguang/scripts/caiguang setup-dev`。
4. 安装仓库内 `plugins/caiguang` 插件并确认其本地 MCP 服务可以列出 `caiguang_*` 工具。MCP 只调用本机脚本，不上传用户素材或登录状态。
5. 先取得用户对同步 Chrome 登录的明确同意，再执行 `pnpm xhs:login`；命令只读 Chrome 会话并复制到采光本机资料目录，不输出 Cookie、不修改 Chrome、失败时不自动扫码。
6. 检查 Eagle 本地 API；未安装时允许跳过。
7. 读取 `data/xhs-account-pins.json` 和 `data/xhs-media-policy.json`。
8. 同时读取 `~/Library/Application Support/采光/data/user-preferences.json`；如果文件存在，以里面的抓取时间、推送时间和用户选中的埋点为准。
9. 执行 `plugins/caiguang/scripts/caiguang schedule install`，让应用里的抓取时间和推送时间由 macOS 本地定时器真正执行。
10. 日常执行 `pnpm daily:auto`；单条调试可执行 `pnpm run capture:h5` 或 `pnpm run capture:xhs`，然后执行 `pnpm run validate:review`。不要再把素材复制回网站静态目录。
11. 确认素材写入 `~/Library/Application Support/采光/review/`，应用应在 2 秒内自动显示新增批阅内容。
12. 不自动把素材上传到公开网络，不自动导入 Eagle，等待用户批阅。用户点 YES 后由应用导入 Eagle；点 NO 后进入本地可恢复回收区。

## 已知安装坑已在程序内处理

- 仓库已自带 `.openai/hosting.json`，本地构建不再因为缺少可选云绑定而失败。
- `pnpm-workspace.yaml` 只批准构建 `esbuild`、`sharp`、`workerd` 三个明确依赖。
- XHS-Downloader 只安装运行依赖，不再执行会误加载 `cx_Freeze` 的可编辑桌面打包入口。
- `setup:downloader` 会同时安装 PyYAML、xhs-cli 与 Camoufox；不需要污染系统 Python。
- 安装器使用依赖指纹与本机缓存：重复安装时不会重跑 pip 或重新下载 Camoufox；只有 requirements/pyproject 改变时才增量更新。设置 `FORCE_SETUP=1` 可强制重建 Python 依赖，设置 `FORCE_CAMOUFOX_FETCH=1` 可强制刷新浏览器。
- `caiguang logout` 已连接正式注销命令，只删除采光自己的会话副本，不修改 Chrome。
- H5 命令兼容 pnpm 的 `--` 参数转发，并会自动截取主体、排除推荐流、检测和下载 MP4。
- 如果页面检测到视频但 MP4 未成功保存，任务会失败并阻止进入批阅，不会再误报“页面没有视频”。

## 验收标准

- 应用首次无素材时显示三步设置页。
- 抓取完成后无需刷新，自动进入批阅页。
- 图片、视频与 Live Photo 使用本地文件，不依赖会过期的远程链接。
- NO 后素材目录移动到 `~/Library/Application Support/采光/trash/`。
- 紧接着按 `Command + Z`，素材和批阅条目都能恢复。
- YES 时 Eagle 未启动会显示明确提示；Eagle 已启动则自动创建/使用“小红书”文件夹并复核图片尺寸。
