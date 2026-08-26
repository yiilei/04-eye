---
name: xhs-visual-capture
description: Complete local capture of Xiaohongshu notes for the Caiguang review application. Uses deterministic download first, then an authorized-browser media manifest fallback when local parsers are incompatible.
---

# 小红书视觉素材抓取

从项目根目录执行。首选确定性下载器：

```bash
pnpm capture:xhs -- --url '<post-url>' --slug '<stable-id>' --account-name '<name>' --account-id '<id>' --title '<title>'
```

成功标准是最后一行紧凑 JSON 包含 `"ok": true`。命令会下载所有可用图片、独立视频和 Live Photo MP4，生成 manifest，并在进入批阅页前完成验证。

## 自动降级

1. 主下载器只执行一次；仅签名链接明确缺失时可补齐当前链接后再试一次。
2. `成功 0 个`、`noteDetailMap` 超时、返回结构不兼容时，不重复调用同一解析器，进入已授权浏览器只读降级。
3. 浏览器必须核对作者、标题、帖子 ID、完整轮播数和 Live Photo 映射，只返回公开媒体清单，不返回 Cookie、token 或请求头。
4. 将清单写入系统临时目录，执行：

```bash
pnpm import:xhs-browser -- --manifest '<temp-json>' --slug '<stable-id>'
```

5. 导入器只接受 HTTPS 小红书页面与 `*.xhscdn.com` 媒体，完成尺寸、顺序、重复图和 MP4 校验后再调用统一采光规范化流程；临时清单会自动删除。导入成功后再次运行 `pnpm daily:run`，确认 `browserCapture: 0` 并安全推进账号基线。
6. 自动化浏览器出现“安全限制”时不做反检测；只复用用户已经打开并明确授权的目标标签页读取公开媒体清单，不复制该标签页 Cookie，不新建携带同一会话的 Chrome/Camoufox。

## 必须遵守

- 不用缩略图、截图或部分轮播替代完整抓取。
- 确定性命令成功时不要逐张浏览。
- 不复制、输出或持久化浏览器 Cookie、`xsec_token`、Authorization 或请求头。
- 不点赞、收藏、评论、关注或发布内容。
- 不自动建立账号黑名单；网络错误有限重试，解析不兼容转浏览器降级，只有登录、验证码或权限问题才通知用户。
- 素材保留在本机；用户点击 YES 前不导入 Eagle。
- 最终只返回数量、校验状态和本地 manifest 路径。
- 多个抓取任务可并行发起，但采光会用本地锁串行访问共享下载目录。

详细架构和失败处理见 [pipeline.md](references/pipeline.md)。
