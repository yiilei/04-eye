import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("desktop onboarding detects the capture-engine session and exposes the bridge", async () => {
  const [main, preload, page, sessionScript, authScript] = await Promise.all([
    readFile(new URL("desktop/main.mjs", root), "utf8"),
    readFile(new URL("desktop/preload.cjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("scripts/xhs-session.mjs", root), "utf8"),
    readFile(new URL("vendor/xhs-cli/xhs_cli/auth.py", root), "utf8"),
  ]);

  assert.match(main, /captureCookieFile/);
  assert.match(main, /cookies\.a1 && cookies\.web_session/);
  assert.match(main, /"isolated_qrcode", "chrome_snapshot"/);
  assert.doesNotMatch(main, /session\.defaultSession\.cookies/);
  assert.match(main, /采光-登录小红书\.command/);
  assert.match(main, /login", "--browser/);
  assert.match(main, /login --qrcode/);
  assert.match(main, /Google Chrome/);
  assert.match(main, /openXhsChromeLogin/);
  assert.match(main, /caiguang:open-xhs-login/);
  assert.match(main, /caiguang:sync-xhs-login/);
  assert.match(main, /caiguang:xhs-login-status/);
  assert.doesNotMatch(main, /caiguang:open-app-management-settings/);
  assert.doesNotMatch(main, /caiguang:download-update/);
  assert.match(preload, /openXhsLogin/);
  assert.match(preload, /syncXhsLogin/);
  assert.doesNotMatch(preload, /openAppManagementSettings/);
  assert.doesNotMatch(preload, /downloadUpdate/);
  assert.match(preload, /onXhsLoginChanged/);
  assert.match(page, /setXhsSetupStatus\("已登录"\)/);
  assert.match(page, /bridge\?\.getXhsLoginStatus\?\.\(\)/);
  assert.match(page, /bridge\?\.onXhsLoginChanged\?\.\(/);
  assert.match(page, /setInterval\(\(\) => void checkEagle\(\), 1_500\)/);
  assert.match(page, /使用 Chrome 登录/);
  assert.match(page, /当前版本为测试版本/);
  assert.match(page, /first-run-test-version/);
  for (const profileId of [
    "6041ed6c0000000001005c1f",
    "60974b9b0000000001003dfb",
    "62ec7ae1000000001f015394",
    "67b064b5000000000e013f9d",
    "629495a80000000021021b10",
    "68ae7835000000001900c4a4",
  ]) assert.match(page, new RegExp(profileId));
  assert.match(page, /优先只读复制 Chrome 当前登录状态/);
  assert.match(page, /completeAfterChromeReturn/);
  assert.match(page, /bridge\.syncXhsLogin\(\)/);
  assert.doesNotMatch(page, /completeAfterChromeReturn[\s\S]{0,500}bridge\.openXhsLogin\(\)/);
  assert.match(page, /document\.visibilityState !== "visible"/);
  assert.match(page, /正在同步/);
  assert.doesNotMatch(page, /系统权限：允许应用更新/);
  assert.doesNotMatch(page, /下载并安装/);
  assert.match(page, /把版本页链接发给 Codex/);
  assert.match(sessionScript, /\["login", "--qrcode"\]/);
  assert.match(sessionScript, /XHS_CLI_DISABLE_BROWSER_COOKIE: command === "login-chrome" \? "0" : "1"/);
  assert.match(sessionScript, /"login-chrome" \? \["login", "--browser"\]/);
  assert.match(authScript, /CAIGUANG_CHROME_FALLBACK/);
  assert.match(authScript, /browser_cookie3/);
  assert.doesNotMatch(authScript, /cookie_file = chrome_root|save_cookies\(.*browser/i);
  assert.match(authScript, /SAFE_SESSION_SOURCES = \{"isolated_qrcode", "chrome_snapshot"\}/);
  assert.match(authScript, /CAIGUANG_CHROME_FALLBACK/);
});

test("desktop can force the real onboarding route for a fresh-run test", async () => {
  const main = await readFile(new URL("desktop/main.mjs", root), "utf8");
  assert.match(main, /process\.argv\.includes\("--onboarding"\)/);
  assert.match(main, /searchParams\.set\("onboarding", "1"\)/);
});

test("native onboarding and review chrome expose drag regions without swallowing controls", async () => {
  const [css, page] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
  ]);
  assert.match(css, /\.workspace::before,[\s\S]*\.first-run-shell::before[\s\S]*-webkit-app-region: drag/);
  assert.match(css, /\.window-controls button[\s\S]*-webkit-app-region: no-drag/);
  assert.match(page, /悬停查看快捷键/);
  assert.match(page, /role="tooltip" aria-label="快捷键提示"/);
  assert.match(page, /shortcutHelpPinned/);
  assert.match(page, /shortcutHelpSuppressed/);
  assert.match(page, /formatPostCaption/);
  assert.doesNotMatch(page, /shortcut-help-toggle/);
  assert.match(page, /className={`post-caption/);
  assert.match(css, /\.post-caption[\s\S]*overflow-y: auto/);
  assert.match(page, /Revalidate only when the selected material actually changes;[\s\S]*\}, \[current\.id\]\);/);
});

test("X captures only the visible canvas and sends the PNG to Eagle", async () => {
  const [main, preload, page, css] = await Promise.all([
    readFile(new URL("desktop/main.mjs", root), "utf8"),
    readFile(new URL("desktop/preload.cjs", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(main, /caiguang:capture-canvas/);
  assert.match(main, /webContents\.capturePage/);
  assert.match(preload, /captureCanvas/);
  assert.match(preload, /cleanupCapture/);
  assert.match(main, /10 \* 60 \* 1_000/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "x"/);
  assert.match(page, /getBoundingClientRect\(\)/);
  assert.match(page, /当前画板可见区域/);
  assert.match(page, /\["采光", "画板截取", "小红书", "PNG"\]/);
  assert.match(css, /\.viewer\.is-capturing \.gallery-hotspot/);
});

test("post bylines prefer published or edited time and never substitute capture time", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /if \(item\.editedAt\)/);
  assert.match(page, /if \(item\.publishedAt\)/);
  assert.match(page, /Number\.parseInt\(noteId\.slice\(0, 8\), 16\)/);
  assert.match(page, /return "日期未知"/);
  assert.match(page, /<time aria-label=\{displayDate\}>\{displayDate\}<\/time>/);
});

test("automatic capture switch persists and gates the local scheduler", async () => {
  const [page, css, scheduler, server] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("scripts/caiguang-scheduler.mjs", root), "utf8"),
    readFile(new URL("desktop/server.mjs", root), "utf8"),
  ]);
  assert.match(page, /automaticCaptureEnabled/);
  assert.match(page, /role="switch"/);
  assert.match(page, /aria-checked=\{automaticCaptureEnabled\}/);
  assert.match(page, /creatorH5CaptureEnabled/);
  assert.match(page, /aria-checked=\{creatorH5CaptureEnabled\}/);
  assert.match(css, /\.settings-automation-row[\s\S]*background: #ffe600/);
  assert.match(scheduler, /!schedulerEnabled\(preferences\)[\s\S]*await stopWakeLock\(\)[\s\S]*return/);
  assert.match(scheduler, /spawn\("\/usr\/bin\/caffeinate", \["-s"\]/);
  assert.match(page, /<strong>防休眠<\/strong>/);
  assert.match(page, /已开启 · 接通电源时锁屏不休眠/);
  assert.match(page, /runtimeStatus\?\.wakeLock\.enabled/);
  assert.match(server, /automaticCaptureEnabled: payload\.automaticCaptureEnabled/);
  assert.match(server, /creatorH5CaptureEnabled: payload\.creatorH5CaptureEnabled/);
});

test("pin footer exposes export action and account-count risk guidance", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
  ]);
  assert.match(page, /pinExport\.count <= 30/);
  assert.match(page, /pinExport\.count <= 60/);
  assert.match(page, /data-tooltip="一键导出埋点数据"/);
  assert.match(page, /当前被小红书反爬虫机制查杀的概率为/);
  assert.match(page, /pin-risk-dot risk-/);
  assert.match(css, /\.pin-panel-footer/);
  assert.match(css, /\.pin-risk-dot\.risk-medium/);
  assert.match(css, /\.pin-risk-dot\.risk-high/);
});

test("failed H5 previews can never be imported into Eagle as complete material", async () => {
  const [page, fallback] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("scripts/register-h5-fallback.mjs", root), "utf8"),
  ]);

  assert.match(page, /decisions\[item\.id\] === "kept" && !eagleItems\[item\.id\] && !item\.previewOnly/);
  assert.match(page, /当前是失败兜底预览。采光会定时补抓完整活动/);
  assert.doesNotMatch(page, /已标记保留；现在开始下载完整原帖/);
  assert.match(fallback, /已保留封面和创作服务中心入口/);
});

test("reviewed media is treated as temporary bridge storage", async () => {
  const [server, auto, page, cleanup, packager] = await Promise.all([
    readFile(new URL("../desktop/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/review-cache-cleanup.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package-macos-app.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(server, /cleanupReviewedMedia\(dataRoot\)/);
  assert.match(auto, /cleanup_reviewed_media/);
  assert.match(page, /下次抓取或重新打开采光时会永久删除本地文件/);
  assert.match(cleanup, /decision === "kept"/);
  assert.match(cleanup, /purgedRejected/);
  assert.match(packager, /packagedApp, "scripts"/);
  assert.match(packager, /review-cache-cleanup\.mjs/);
});

test("onboarding stays usable in compact windows and its public assets resolve", async () => {
  const [css, page, layout, pendingRoute] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/api/pending-pins/route.ts", root), "utf8"),
  ]);

  assert.match(css, /\.first-run-setup \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow-y: auto/);
  assert.match(css, /\.first-run-footer \{[^}]*position: sticky;[^}]*bottom: -1px/);
  assert.match(css, /width: min\(calc\(100vw - 64px\),calc\(\(100vh - 64px\) \* 4 \/ 3\)\)/);
  assert.doesNotMatch(page, /caiguang-icon\.svg/);
  assert.doesNotMatch(layout, /caiguang-icon\.svg/);
  assert.match(layout, /favicon\.svg/);
  assert.match(pendingRoute, /process\.env\.INIT_CWD \|\| process\.env\.PWD/);
  assert.match(pendingRoute, /mkdir\(path\.dirname\(pendingPath\), \{ recursive: true \}\)/);
  assert.match(page, /if \(!hydrated \|\| !desktopAppMode\) return;[\s\S]*fetch\("\/api\/pending-pins"/);
});

test("desktop packager replaces rather than merges the previous app payload", async () => {
  const packager = await readFile(new URL("scripts/package-macos-app.mjs", root), "utf8");
  assert.match(packager, /await rm\(packagedApp, \{ recursive: true, force: true \}\)/);
  assert.match(packager, /await rm\(packagedRuntime, \{ recursive: true, force: true \}\)/);
  assert.match(packager, /pnpm", \["prune", "--prod", "--ignore-scripts"\]/);
  assert.match(packager, /runtimeNodeModulesKilobytes > 100 \* 1024/);
});
