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
  assert.match(main, /caiguang:xhs-login-status/);
  assert.match(preload, /openXhsLogin/);
  assert.match(preload, /onXhsLoginChanged/);
  assert.match(page, /setXhsSetupStatus\("已登录"\)/);
  assert.match(page, /setInterval\(\(\) => void checkEagle\(\), 1_500\)/);
  assert.match(page, /使用 Chrome 登录/);
  assert.match(page, /优先只读复制 Chrome 当前登录状态/);
  assert.match(page, /completeAfterChromeReturn/);
  assert.match(page, /document\.visibilityState !== "visible"/);
  assert.match(page, /正在同步/);
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
  assert.match(scheduler, /!schedulerEnabled\(preferences\)\) return/);
  assert.match(server, /automaticCaptureEnabled: payload\.automaticCaptureEnabled/);
  assert.match(server, /creatorH5CaptureEnabled: payload\.creatorH5CaptureEnabled/);
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
  const [server, auto, page, cleanup] = await Promise.all([
    readFile(new URL("../desktop/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../scripts/review-cache-cleanup.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(server, /cleanupReviewedMedia\(dataRoot\)/);
  assert.match(auto, /cleanup_reviewed_media/);
  assert.match(page, /下次抓取或重新打开采光时会永久删除本地文件/);
  assert.match(cleanup, /decision === "kept"/);
  assert.match(cleanup, /purgedRejected/);
});

test("onboarding stays usable in compact windows and its public assets resolve", async () => {
  const [css, page, layout, pendingRoute] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/api/pending-pins/route.ts", root), "utf8"),
  ]);

  assert.match(css, /\.first-run-setup \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*overflow-y: auto/);
  assert.match(css, /width: min\(calc\(100vw - 64px\),calc\(\(100vh - 64px\) \* 4 \/ 3\)\)/);
  assert.doesNotMatch(page, /caiguang-icon\.svg/);
  assert.doesNotMatch(layout, /caiguang-icon\.svg/);
  assert.match(layout, /favicon\.svg/);
  assert.match(pendingRoute, /process\.env\.INIT_CWD \|\| process\.env\.PWD/);
  assert.match(pendingRoute, /mkdir\(path\.dirname\(pendingPath\), \{ recursive: true \}\)/);
  assert.match(page, /if \(!hydrated \|\| !desktopAppMode\) return;[\s\S]*fetch\("\/api\/pending-pins"/);
});
