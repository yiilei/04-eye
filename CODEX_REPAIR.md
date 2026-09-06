# 把采光交给 Codex 修复

## 发给 Codex 的话

```text
请先读取采光当前安装版本，再 checkout GitHub 上完全一致的 tag。保留 ~/Library/Application Support/采光，不删除登录、埋点、素材和批阅记录。先运行 plugins/caiguang/scripts/caiguang doctor 并读取当日日报与日志，复现问题，补回归测试，再修复和构建。不要上传 Cookie、个人账号数据、抓取素材或 Eagle 内容。
```

## Codex 应先收集

- 应用版本、macOS 版本和芯片架构。
- 页面错误文字、截图和可重现的操作。
- `~/Library/Application Support/采光/data/reports/` 的当日报告。
- `~/Library/Application Support/采光/logs/` 中对应时间的日志，对外发送前删去个人资料。

## 修复底线

- 不在旧版源码上盲修；安装版本与 Git tag 必须一致。
- 不把错误的抓取标成完成，不因解析失败删除原始证据。
- YES 必须在 Eagle 真正导入成功后才记录；NO 先进可恢复区，下次启动或抓取前再清理。
- 新增或修复的分支要有自动测试，并通过生产构建、模块完整性和签名校验。
