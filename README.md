# 采光

“采光”是一个本地运行的小红书视觉素材采集与批阅工具。公开版预置 10 个设计/运营账号埋点，不包含任何登录凭证、Cookie 或私人素材。

## 最快开始

1. 下载 GitHub Release 中的“采光-完整安装包-macOS-arm64.zip”。
2. 完整解压后双击“开始安装.command”，它会安装应用、源代码、采集引擎、macOS 定时器与 Codex 插件。
3. 启动 Eagle（可选）。
4. 打开 Codex，把安装包内“发给Codex.txt”的内容发给它；首次测试可以直接说：

```text
帮我抓取最新的小红书创作服务活动
```

首次使用时，先在 Chrome 登录小红书，再在采光中点击“登录”。采光会在用户明确操作后把 Chrome 当前会话复制到自己的本地资料目录；不会修改 Chrome，也不会自动改用二维码登录。同步完成后，发现、下载、清晰度校验和批阅登记都由本地脚本完成。Codex 只在登录失效、页面结构变化或特殊 H5 提取失败时介入。

从 v0.1.1 开始，抓取脚本和桌面应用共用同一个本地资料库。素材完成校验后，已经打开的应用会自动从首次设置页切换到批阅页，不需要刷新或重新启动。

## 第一次使用

- 小红书：先在 Chrome 登录，再在源码目录运行 `pnpm xhs:login`。该命令只在用户同意后同步 Chrome 当前会话到采光的本机资料目录；仓库不保存账号密码或 Cookie，失败时也不会自动弹出二维码。
- Eagle：启动 Eagle 后，应用通过 `127.0.0.1:41595` 检测本地连接。点 YES 时才导入；“小红书”文件夹不存在时会自动创建。暂时不用 Eagle 也可以先抓取和批阅。
- 埋点：设置页可搜索小红书用户，或直接粘贴账号主页链接并点击“埋点”。
- 时间：设置页可选择每天抓取时间和批阅提醒时间；安装器创建的 macOS 本地定时器每分钟读取该配置，真正执行采集与系统提醒。

## 完整闭环

```text
本地发现脚本检查新增
→ 脚本下载最高可用清晰度素材
→ manifest / 顺序 / 尺寸 / Live Photo 配对校验
→ 写入应用本地资料库
→ 采光自动出现批阅内容
→ YES 导入 Eagle；NO 移入可恢复回收区
```

日常只需执行 `pnpm daily:auto`。它会依次完成新增发现、下载、校验、登记与日报；若尚未同步登录，发现脚本会明确返回 `login_required`，不会误把历史帖子加入批阅。

## 接入不同 Agent

采光插件内置本地 MCP 服务。Codex、Claude Desktop、Cursor 或其他支持 MCP 的 Agent 都可以调用同一套本地能力，不需要为每个 Agent 重写抓取程序。

MCP 提供：读取状态、添加账号埋点、验证账号、抓取指定帖子、运行每日流程、读取日报和打开批阅页。它只启动使用者电脑上的采光脚本；小红书会话、图片、视频、批阅决定和 Eagle 连接不会上传到 MCP 云服务。

仓库中的 Codex 插件入口为 `plugins/caiguang/.mcp.json`。其他 MCP 客户端可使用相同的 stdio 启动器：

```text
command: <采光源码目录>/plugins/caiguang/scripts/mcp-launcher
```

因此分发时可以只提供本仓库链接：使用者安装采光完整包及插件后，即可在自己的 Agent 中连接本地 MCP。每位使用者仍需在自己的电脑上完成一次小红书登录和可选的 Eagle 连接。

`Command + Z` 可以撤回刚才的 NO：素材文件会从应用回收区恢复，而不是只恢复界面状态。应用资料库位于 `~/Library/Application Support/采光/`；旧版 `04的眼` 数据会在首次启动时无损迁移。

详细的 Codex 安装与接管说明见 [INSTALL_WITH_CODEX.md](INSTALL_WITH_CODEX.md)。

## 从源码构建

```bash
pnpm install
pnpm run setup:downloader
pnpm run desktop:package:public
```

上面是开发/打包流程。已安装预构建桌面应用的普通用户请运行
`plugins/caiguang/scripts/caiguang setup`：它只安装运行依赖，并复用 pip、pnpm
与 Camoufox 的本机缓存；重复执行时通常会在数秒内完成。

生成的 macOS 应用和完整安装包都在 `release/desktop`。完整安装包同时包含桌面应用、完整源代码、Codex Skill、公开埋点、采集与校验脚本以及安装说明。当前测试包为 Apple Silicon 版并使用临时签名，首次打开时如被 macOS 拦截，请在访达中右键应用并选择“打开”；正式分发版将补充 Intel 构建、Apple Developer ID 签名与公证。

## 隐私

所有抓取素材、批阅决定和 Eagle 数据默认只保存在使用者自己的电脑。公开仓库仅包含程序、规则和示例账号埋点。

## 复用的开源组件

- [`jackwener/xhs-cli`](https://github.com/jackwener/xhs-cli)（Apache-2.0）：固定主页身份核验、最新帖子发现与本机浏览器会话读取。
- [`JoeanAmier/XHS-Downloader`](https://github.com/JoeanAmier/XHS-Downloader)：帖子图片、视频与 Live Photo 素材下载。

项目只在这两层之间补充队列、基线保护、轮播顺序校验、批阅登记和 Eagle 工作流，避免重复实现成熟的浏览器登录与媒体提取能力。
