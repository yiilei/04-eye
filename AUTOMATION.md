# 每日自动采集（Codex 约 10%）

## 分工

1. 本地 `xhs-cli` 登录态直接访问已验证的固定主页，只做“发现新增链接与核对账号身份”。
2. 本地发现脚本把检查结果写入 `data/xhs-capture-queue.json`；Codex 浏览器只作为登录失效或页面结构异常时的只读备用。
3. 本地脚本执行下载、Live Photo 配对、尺寸与哈希校验、批阅登记、埋点更新和日报；应用通过本地资料库自动刷新，不再为每次抓取重新构建前端。
4. 只有日报中“需要 Codex 处理”的失败项才进入人工排错。

## 安全检查

```bash
pnpm daily:check
```

它只检查埋点、策略和队列格式，不下载、不改动素材。

## 正式运行

```bash
pnpm daily:run
```

## 首次建立独立登录态

用户明确同意后，登录助手会读取 Chrome 当前小红书会话并复制到采光的隔离资料目录。它不会修改 Chrome，也不会自动退回二维码登录。首次使用运行：

```bash
pnpm xhs:login
```

同步完成后，采光的登录态只保存在本机应用资料目录。检查状态：

```bash
pnpm xhs:status
```

日常完整运行使用：

```bash
pnpm daily:auto
```

它会先完成账号发现并安全写入队列，再执行下载、校验、登记与日报。需要分步排错时，仍可分别运行 `pnpm discover:xhs -- --write` 和 `pnpm daily:run`。

日报输出到 `data/reports/YYYY-MM-DD-daily.md`。正常情况下这一阶段不需要 Codex。

桌面应用中设定的时间和账号选择保存在 `~/Library/Application Support/采光/data/user-preferences.json`。完整安装器会注册 `com.yilei.caiguang.scheduler` 本地 LaunchAgent，每分钟读取该文件，在抓取时间执行 `daily:auto`，在推送时间发送 macOS 通知。检查状态：

```bash
plugins/caiguang/scripts/caiguang schedule status
```

当前本地定时器负责已验证账号的新增发现、下载和校验。创作服务中心 H5 仍由 Codex 的每日发现任务加入队列，因为它需要当前登录浏览器会话和页面主体判断。

## 队列格式

普通帖子任务：

```json
{
  "id": "账号-帖子ID",
  "type": "note",
  "status": "pending",
  "accountKey": "小红书号或 searchKey",
  "title": "帖子标题",
  "slug": "稳定文件夹名称",
  "sourceUrl": "最新有效帖子链接"
}
```

H5 活动任务额外提供 `sourceDir` 和可选的 `displayDate`。H5 主体提取仍属于 Codex 的异常/特殊页面工作。

账号检查结果写入 `checkedAccounts`。只有该账号所有新增任务成功后，流水线才更新 `lastSeenPostId`，避免中途失败造成漏抓。
