---
name: caiguang
description: 运行采光的小红书视觉素材发现、完整采集、校验、日报和本地批阅流程。适用于用户要求检查埋点、抓取帖子或活动、运行每日任务、诊断采集异常或打开批阅应用。
---

# 采光

始终优先调用本插件提供的 `caiguang_*` MCP 工具，不要手工逐张下载。MCP 不可用时才调用 `scripts/caiguang`。

## 工作原则

1. 账号埋点以 `data/xhs-account-pins.json` 为唯一来源。
2. 媒体策略以 `data/xhs-media-policy.json` 为唯一来源。
3. 发现结果只写入 `data/xhs-capture-queue.json`，随后运行 `daily`。
4. 普通帖子由本地下载器保存全部图片、Live Photo 配对 MP4 或独立视频。
5. 组图顺序、文件完整性、尺寸、哈希和 MP4 必须通过校验后才能进入批阅页。
6. Codex 只在 `login_required`、`pin_invalid`、`order_verification_failed`、反爬或页面结构变化时介入。
7. 不自动导入 Eagle；由用户在批阅页作出保留或删除决定。

## 命令

从项目根目录运行：

```bash
plugins/caiguang/scripts/caiguang doctor
plugins/caiguang/scripts/caiguang login
plugins/caiguang/scripts/caiguang status
plugins/caiguang/scripts/caiguang discover --write
plugins/caiguang/scripts/caiguang verify
plugins/caiguang/scripts/caiguang daily
plugins/caiguang/scripts/caiguang schedule status
plugins/caiguang/scripts/caiguang check
plugins/caiguang/scripts/caiguang app
```

抓取单篇帖子时，把原帖 URL 透传给 `capture`：

```bash
plugins/caiguang/scripts/caiguang capture --url '<小红书帖子链接>' --title '<标题>'
```

## 失败处理

- `login_required`：先让用户在 Chrome 登录并明确同意同步，再调用 `login`。只允许复制到采光本机资料目录，不输出 Cookie、不修改 Chrome；失败时不得自动扫码。
- `pin_invalid`：停止该账号，核验显示名、小红书号、内部 ID 与固定主页；禁止绑定相似账号。
- 组图顺序未核验：不得进入批阅页；先检查下载器 `imageList` 顺序证据和连续源序号。
- 下载或反爬失败：保留错误，最多修复后重跑一次。

完成后只汇报脚本生成的日报及仍需人工处理的异常。
