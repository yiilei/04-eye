# 每日自动采集（Codex 约 10%）

## 分工

1. Codex 使用已经登录的小红书页面，只做“发现新增链接与核对账号身份”。
2. Codex 把检查结果写入 `data/xhs-capture-queue.json`。
3. 本地脚本执行下载、Live Photo 配对、尺寸与哈希校验、批阅登记、埋点更新、构建和日报。
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

日报输出到 `data/reports/YYYY-MM-DD-daily.md`。正常情况下这一阶段不需要 Codex。

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
