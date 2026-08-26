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
  assert.match(main, /sessionSource === "isolated_qrcode"/);
  assert.doesNotMatch(main, /session\.defaultSession\.cookies/);
  assert.match(main, /采光-登录小红书\.command/);
  assert.doesNotMatch(main, /login --browser/);
  assert.match(main, /login --qrcode/);
  assert.match(main, /Google Chrome/);
  assert.match(main, /openXhsChromeLogin/);
  assert.match(main, /caiguang:open-xhs-login/);
  assert.match(main, /caiguang:xhs-login-status/);
  assert.match(preload, /openXhsLogin/);
  assert.match(preload, /onXhsLoginChanged/);
  assert.match(page, /setXhsSetupStatus\("已登录"\)/);
  assert.match(page, /setInterval\(\(\) => void checkEagle\(\), 1_500\)/);
  assert.match(page, /已在 Chrome 登录/);
  assert.match(page, /在 Chrome 登录/);
  assert.match(page, /不会创建新会话，也不会读取 Chrome Cookie/);
  assert.match(page, /completeAfterChromeReturn/);
  assert.match(page, /document\.visibilityState === "visible"/);
  assert.doesNotMatch(page, /同步 Chrome 中已登录/);
  assert.match(sessionScript, /\["login", "--qrcode"\]/);
  assert.match(sessionScript, /XHS_CLI_DISABLE_BROWSER_COOKIE: "1"/);
  assert.doesNotMatch(sessionScript, /--browser/);
  assert.doesNotMatch(authScript, /Google\/Chrome|browser_cookie3|bc3\.chrome|chrome_root|cookie_file = chrome_root/);
  assert.match(authScript, /SAFE_SESSION_SOURCES = \{"isolated_qrcode"\}/);
  assert.match(authScript, /Browser cookie import is disabled/);
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
  assert.match(css, /\.settings-automation-row[\s\S]*background: #ffe600/);
  assert.match(scheduler, /!schedulerEnabled\(preferences\)\) return/);
  assert.match(server, /automaticCaptureEnabled: payload\.automaticCaptureEnabled/);
});
