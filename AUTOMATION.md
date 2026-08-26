# 每日自动采集（本地优先，MyFlicker 仅处理解析降级）

## 分工

1. 本地 `xhs-cli` 登录态直接访问已验证的固定主页，只做“发现新增链接与核对账号身份”；发现器兼容分页嵌套数组以及 `noteCard.noteId` / `noteCard.xsecToken`。
2. 本地发现脚本把检查结果写入 `data/xhs-capture-queue.json`；主下载器失败且属于解析不兼容时，任务进入 `needs_browser_capture`，由 MyFlicker 使用已授权的正常浏览器只读提取完整媒体清单。
3. 浏览器降级只返回帖子身份、完整轮播、尺寸和 Live Photo 映射，不返回 Cookie、token 或请求头；`scripts/xhs-browser-media-import.py` 负责 HTTPS/CDN 白名单、下载、完整性预检和临时文件清理。
4. 所有路径最终统一进入 `scripts/xhs-capture.py --source-dir`，完成 Live Photo 配对、尺寸与哈希校验、批阅登记、埋点更新和日报；应用通过本地资料库自动刷新，不为每次抓取重新构建前端。
5. 网络错误有限重试；解析不兼容自动降级；只有登录、验证码、明确权限不足或完整性失败才需要用户处理。系统不维护自动账号黑名单。

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

运行 `pnpm xhs:login` 后，使用小红书 App 扫描终端二维码。登录助手只创建采光隔离会话，不读取、打开或修改 Chrome，也不会复用主 Chrome 的 `web_session`：

```bash
pnpm xhs:login
```

独立登录完成后，采光会话只保存在本机应用资料目录。旧版从 Chrome 复制且没有 `sessionSource: isolated_qrcode` 标记的会话不会被自动使用。检查状态：

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

当前本地定时器负责已验证账号的新增发现、下载和校验。创作服务中心 H5 使用采光隔离会话；解析器受到安全限制时由 MyFlicker 复用用户已经打开并授权的标签页只读获取公开媒体清单，禁止复制该标签页 Cookie 到新浏览器。

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
