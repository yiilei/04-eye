# v0.3.46 验收记录

## 修复

- 启动时不再只凭 launchd 已加载和 runner 内容判断调度器可用。
- runner、LaunchAgent plist、日志路径和私有 Node 必须全部指向当前正式位置，否则自动重建。
- 覆盖临时测试目录残留、私有 Node 丢失和 runner 缺失三种状态测试。

## 本机事故复现

- 2026-09-08 原 LaunchAgent 指向 `/private/tmp/caiguang-package-qa...`，最近退出码为 127。
- 当日计划时间为 00:54，但未产生 2026-09-08 抓取日志或日报。
- 重建后 LaunchAgent 指向 `~/Library/Application Support/采光/runtime/scheduler-runner.zsh`，并立即识别今日漏跑、进入补抓。

## 边界

- 关机和真正睡眠期间无法运行；恢复开机后由漏跑规则补抓。
- 登录过期、验证码、平台风控与网络持续中断仍会进入明确待处理或后续重试状态。
