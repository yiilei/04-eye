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
4. 普通帖子先由本地下载器保存全部图片、Live Photo 配对 MP4 或独立视频；解析不兼容时自动转入 `needs_browser_capture`。
5. MyFlicker 浏览器降级只读提取作者、标题、帖子 ID、完整轮播与 Live Photo 映射，再通过 `browser-import` 交给采光；不输出 Cookie、token 或请求头。
6. 组图顺序、文件完整性、尺寸、哈希和 MP4 必须通过校验后才能进入批阅页。
7. 不建立自动账号黑名单；网络错误有限重试，登录、验证码、权限不足才通知用户。
8. 不自动导入 Eagle；由用户在批阅页作出保留或删除决定。

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

- `login_required`：优先运行 `login`，让用户使用小红书 App 扫描终端二维码建立采光隔离会话。夜间脚本仅在独立会话不可用且 `CAIGUANG_CHROME_FALLBACK=1` 时，使用一次只读 Chrome Cookie 快照完成本次发现；不得写入或删除 Chrome Cookie，也不得把快照持久化到采光会话。
- `pin_invalid`：停止该账号，核验显示名、小红书号、内部 ID 与固定主页；禁止绑定相似账号。
- `needs_browser_capture`：MyFlicker 只复用用户已经打开且明确授权的目标标签页生成临时媒体清单，不复制 Cookie，也不新建携带同一会话的浏览器；随后执行 `plugins/caiguang/scripts/caiguang browser-import --manifest '<temp-json>' --slug '<slug>'`，再运行 `daily` 推进账号基线。
- 组图顺序未核验：不得进入批阅页；先检查下载器 `imageList` 顺序证据和连续源序号。
- 网络错误：按队列策略有限重试；`安全限制` 或解析结构变化不重复撞同一解析器，直接转浏览器降级。
- 不允许自动账号黑名单；只有登录、验证码、明确权限不足或最终完整性失败才需要用户处理。

完成后只汇报脚本生成的日报及仍需人工处理的异常。
