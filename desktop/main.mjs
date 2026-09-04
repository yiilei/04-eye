import { app, BrowserWindow, dialog, ipcMain, nativeImage, Notification, screen, shell } from "electron";
import { existsSync, watch } from "node:fs";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktopServer } from "./server.mjs";
import { migrateLegacyData } from "./data-migration.mjs";
import { checkForUpdate } from "./runtime-status.mjs";
import { currentAppBundle, launchPreparedUpdate, prepareUpdate } from "./app-updater.mjs";

// Embedded Python lives inside the signed app bundle. Never let any child
// process create or update bytecode beside signed resources.
process.env.PYTHONDONTWRITEBYTECODE = "1";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(desktopDir, "..");
let serverHandle;
let mainWindow;
let xhsLoginTimer;
let xhsLoginStarting = false;
let xhsLoginResetTimer;
let xhsChromeSyncTimer;
let xhsChromeSyncDeadline = 0;
let xhsChromeSyncPromise;
let libraryWatcher;
let libraryChangeTimer;
let lastNotificationId = "";
const notificationOnlyLaunch = process.argv.includes("--scheduled-notification");
if (notificationOnlyLaunch && process.platform === "darwin") app.setActivationPolicy("accessory");

const notificationRequestFile = () => path.join(app.getPath("userData"), "data", "notification-request.json");

async function deliverPendingNotification() {
  try {
    const request = JSON.parse(await readFile(notificationRequestFile(), "utf8"));
    if (!request?.id || request.id === lastNotificationId || !request.body) return false;
    lastNotificationId = request.id;
    if (Notification.isSupported()) new Notification({ title: request.title || "采光", body: request.body }).show();
    await rm(notificationRequestFile(), { force: true });
    return true;
  } catch {
    return false;
  }
}

function startLibraryWatcher() {
  libraryWatcher?.close();
  const dataDir = path.join(app.getPath("userData"), "data");
  void mkdir(dataDir, { recursive: true }).then(() => {
    libraryWatcher = watch(dataDir, (_eventType, filename) => {
      if (filename === "notification-request.json") {
        void deliverPendingNotification();
        return;
      }
      if (filename !== "generated-review-items.json") return;
      if (libraryChangeTimer) clearTimeout(libraryChangeTimer);
      libraryChangeTimer = setTimeout(() => {
        mainWindow?.webContents.send("caiguang:library-changed", { updatedAt: new Date().toISOString() });
      }, 120);
    });
  });
}

const captureConfigDir = () => path.join(app.getPath("userData"), "xhs-cli");
const captureCookieFile = () => path.join(captureConfigDir(), "cookies.json");

async function hasXhsCaptureLogin() {
  try {
    const saved = JSON.parse(await readFile(captureCookieFile(), "utf8"));
    const cookies = saved?.cookies || {};
    return ["isolated_qrcode", "chrome_snapshot"].includes(saved?.sessionSource) && Boolean(cookies.a1 && cookies.web_session);
  } catch {
    return false;
  }
}

function stopXhsLoginTimer() {
  if (xhsLoginTimer) clearInterval(xhsLoginTimer);
  xhsLoginTimer = undefined;
}

function stopXhsChromeSync() {
  if (xhsChromeSyncTimer) clearTimeout(xhsChromeSyncTimer);
  xhsChromeSyncTimer = undefined;
  xhsChromeSyncDeadline = 0;
}

async function publishXhsLoginStatus() {
  const loggedIn = await hasXhsCaptureLogin();
  mainWindow?.webContents.send("caiguang:xhs-login-changed", { loggedIn });
  if (loggedIn) {
    xhsLoginStarting = false;
    if (xhsLoginResetTimer) clearTimeout(xhsLoginResetTimer);
    xhsLoginResetTimer = undefined;
    stopXhsLoginTimer();
    stopXhsChromeSync();
  }
  return { loggedIn };
}

function findCaptureEngine() {
  const candidates = [
    path.join(process.resourcesPath, "runtime", "project", "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    path.join(appRoot, "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    path.join(app.getPath("userData"), "source", "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    process.env.CAIGUANG_PROJECT_ROOT && path.join(process.env.CAIGUANG_PROJECT_ROOT, "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    path.join(app.getPath("documents"), "ChatGPT", "小红书创作活动获取", "vendor", "xhs-cli", ".venv", "bin", "xhs"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

const captureProjectRoot = (executable) => path.resolve(path.dirname(executable), "../../../..");

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

// Kept as the isolated QR-session fallback for older launch flows.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function openXhsCaptureLogin() {
  if ((await publishXhsLoginStatus()).loggedIn) return { loggedIn: true };
  if (xhsLoginStarting) return { loggedIn: false, loginStarted: true };
  const executable = findCaptureEngine();
  if (!executable) {
    return { loggedIn: false, error: "未找到采光的小红书登录组件，请先运行完整安装。" };
  }
  xhsLoginStarting = true;
  await mkdir(captureConfigDir(), { recursive: true, mode: 0o700 });
  const helper = path.join(app.getPath("userData"), "采光-登录小红书.command");
  await writeFile(helper, [
    "#!/bin/zsh",
    "clear",
    "echo '正在创建采光独立的小红书会话…'",
    "echo '请用小红书 App 扫描终端二维码。采光不会读取、打开或修改 Chrome。'",
    `export XHS_CLI_CONFIG_DIR=${shellQuote(captureConfigDir())}`,
    "export XHS_CLI_DISABLE_BROWSER_COOKIE=1",
    `${shellQuote(executable)} login --qrcode`,
    "exit_code=$?",
    "if [[ $exit_code -ne 0 ]]; then echo; echo '采光独立登录未完成，请重新扫码；主 Chrome 登录不会受到影响。'; read -k 1 '?按任意键关闭…'; fi",
    "exit $exit_code",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(helper, 0o700);
  const openError = await shell.openPath(helper);
  if (openError) {
    xhsLoginStarting = false;
    return { loggedIn: false, error: openError };
  }
  stopXhsLoginTimer();
  if (xhsLoginResetTimer) clearTimeout(xhsLoginResetTimer);
  xhsLoginResetTimer = setTimeout(() => { xhsLoginStarting = false; xhsLoginResetTimer = undefined; }, 5 * 60 * 1_000);
  xhsLoginTimer = setInterval(() => void publishXhsLoginStatus(), 1_000);
  return { loggedIn: false, loginStarted: true };
}

// First-run onboarding must not create a second Xiaohongshu device session.
// It only opens the user's existing Chrome profile.  In particular, this
// deliberately does not read, copy or modify any browser cookies.
async function openXhsChromeLogin() {
  if ((await publishXhsLoginStatus()).loggedIn) return { loggedIn: true };
  const executable = findCaptureEngine();
  if (executable) {
    await mkdir(captureConfigDir(), { recursive: true, mode: 0o700 });
    const imported = await new Promise((resolve) => {
      execFile(executable, ["login", "--browser"], {
        cwd: captureProjectRoot(executable),
        timeout: 60_000,
        env: {
          ...process.env,
          XHS_CLI_CONFIG_DIR: captureConfigDir(),
          CAIGUANG_CHROME_FALLBACK: "1",
        },
      }, async (error) => resolve(!error || (await hasXhsCaptureLogin())));
    });
    if (imported && (await publishXhsLoginStatus()).loggedIn) {
      return { loggedIn: true, sessionSource: "chrome_snapshot" };
    }
  }
  try {
    await new Promise((resolve, reject) => {
      execFile("/usr/bin/open", ["-a", "Google Chrome", "https://www.xiaohongshu.com/explore"], (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    startXhsChromeAutoSync();
    return { loggedIn: false, chromeOpened: true };
  } catch {
    await shell.openExternal("https://www.xiaohongshu.com/explore");
    startXhsChromeAutoSync();
    return { loggedIn: false, chromeOpened: true };
  }
}

async function syncXhsChromeLogin() {
  if (xhsChromeSyncPromise) return xhsChromeSyncPromise;
  xhsChromeSyncPromise = syncXhsChromeLoginOnce();
  try {
    return await xhsChromeSyncPromise;
  } finally {
    xhsChromeSyncPromise = undefined;
  }
}

async function syncXhsChromeLoginOnce() {
  if ((await publishXhsLoginStatus()).loggedIn) return { loggedIn: true };
  const executable = findCaptureEngine();
  if (!executable) return { loggedIn: false, error: "未找到采光的小红书登录组件，请先运行完整安装。" };
  await mkdir(captureConfigDir(), { recursive: true, mode: 0o700 });
  const imported = await new Promise((resolve) => {
    execFile(executable, ["login", "--browser"], {
      cwd: captureProjectRoot(executable),
      timeout: 60_000,
      env: {
        ...process.env,
        XHS_CLI_CONFIG_DIR: captureConfigDir(),
        CAIGUANG_CHROME_FALLBACK: "1",
      },
    }, async (error) => resolve(!error || (await hasXhsCaptureLogin())));
  });
  if (imported && (await publishXhsLoginStatus()).loggedIn) {
    return { loggedIn: true, sessionSource: "chrome_snapshot" };
  }
  return { loggedIn: false };
}

function startXhsChromeAutoSync() {
  stopXhsChromeSync();
  xhsChromeSyncDeadline = Date.now() + 90_000;
  const retry = async () => {
    xhsChromeSyncTimer = undefined;
    const result = await syncXhsChromeLogin().catch(() => ({ loggedIn: false }));
    if (result.loggedIn || Date.now() >= xhsChromeSyncDeadline) {
      stopXhsChromeSync();
      return;
    }
    xhsChromeSyncTimer = setTimeout(retry, 2_000);
  };
  xhsChromeSyncTimer = setTimeout(retry, 1_500);
}

ipcMain.handle("caiguang:open-xhs-login", () => openXhsChromeLogin());
ipcMain.handle("caiguang:sync-xhs-login", () => syncXhsChromeLogin());
ipcMain.handle("caiguang:xhs-login-status", () => publishXhsLoginStatus());
ipcMain.handle("caiguang:capture-canvas", async (event, requested = {}) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return { ok: false, error: "未找到采光窗口" };
  const bounds = window.getContentBounds();
  const source = requested.rect || {};
  const x = Math.max(0, Math.floor(Number(source.x) || 0));
  const y = Math.max(0, Math.floor(Number(source.y) || 0));
  const width = Math.min(bounds.width - x, Math.floor(Number(source.width) || 0));
  const height = Math.min(bounds.height - y, Math.floor(Number(source.height) || 0));
  if (width < 2 || height < 2) return { ok: false, error: "当前画板没有可截取区域" };
  try {
    const image = await window.webContents.capturePage({ x, y, width, height });
    const directory = path.join(app.getPath("userData"), "captures");
    await mkdir(directory, { recursive: true });
    const safeTitle = String(requested.title || "画板截取").replace(/[\\/:*?"<>|]/g, "-").slice(0, 60);
    const filename = `${safeTitle}-${new Date().toISOString().replace(/[.:]/g, "-")}.png`;
    const target = path.join(directory, filename);
    await writeFile(target, image.toPNG());
    const size = image.getSize();
    return { ok: true, path: target, width: size.width, height: size.height };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "画板截取失败" };
  }
});
ipcMain.handle("caiguang:cleanup-capture", async (_event, value) => {
  const captureRoot = path.resolve(app.getPath("userData"), "captures");
  const target = path.resolve(String(value || ""));
  const relative = path.relative(captureRoot, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
  // Eagle queues addFromPath asynchronously and may not stat/copy the source
  // until several seconds after returning success. Keep the PNG available for
  // ten minutes; cleanup is delayed instead of racing Eagle's import worker.
  const timer = setTimeout(() => void rm(target, { force: true }), 10 * 60 * 1_000);
  timer.unref();
  return true;
});
ipcMain.handle("caiguang:runtime-status", async () => {
  const pidPath = path.join(app.getPath("userData"), "runtime", "caffeinate.pid");
  const pid = Number((await readFile(pidPath, "utf8").catch(() => "")).trim());
  let wakeLockEnabled = false;
  if (Number.isInteger(pid) && pid > 1) {
    try { process.kill(pid, 0); wakeLockEnabled = true; } catch { /* stale pid */ }
  }
  return {
    version: app.getVersion(),
    wakeLock: { enabled: wakeLockEnabled, mode: "ac_only" },
  };
});
ipcMain.handle("caiguang:check-update", () => checkForUpdate({ currentVersion: app.getVersion() }));
ipcMain.handle("caiguang:install-update", async (event) => {
  try {
    const prepared = await prepareUpdate({
      currentVersion: app.getVersion(),
      targetApp: currentAppBundle(),
      notify: (progress) => event.sender.send("caiguang:update-progress", progress),
    });
    if (prepared.state !== "ready") return prepared;
    event.sender.send("caiguang:update-progress", { state: "installing", percent: 100, message: "即将重启完成更新" });
    launchPreparedUpdate(prepared);
    setTimeout(() => app.quit(), 250);
    return { state: "restarting", latestVersion: prepared.latestVersion };
  } catch (error) {
    return { state: "unavailable", message: error instanceof Error ? error.message : "更新失败，请稍后再试" };
  }
});
ipcMain.handle("caiguang:open-release", (_event, value) => {
  const url = String(value || "");
  if (!/^https:\/\/github\.com\/yiilei\/04-eye\/releases\/tag\/v[\d.]+$/u.test(url)) return false;
  void shell.openExternal(url);
  return true;
});
ipcMain.handle("caiguang:fit-window", (event, requested = {}) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return undefined;

  const aspect = Math.min(5 / 3, Math.max(9 / 16, Number(requested.mediaAspect) || 3 / 4));
  const sidebarWidth = Math.min(700, Math.max(0, Number(requested.sidebarWidth) || 0));
  const display = screen.getDisplayMatching(window.getBounds());
  const workArea = display.workArea;
  const preferredWindowScale = 0.8;
  const maxWidth = Math.max(760, Math.floor(workArea.width * preferredWindowScale));
  const maxHeight = Math.max(500, Math.floor(workArea.height * preferredWindowScale));

  // Use the largest native window that keeps the actual review canvas at the
  // requested material ratio. Sidebars are added outside that canvas.
  const heightFromWidth = (maxWidth - sidebarWidth) / aspect;
  const height = Math.round(Math.min(maxHeight, Math.max(480, heightFromWidth)));
  const width = Math.round(Math.min(maxWidth, Math.max(680, height * aspect + sidebarWidth)));
  const current = window.getBounds();
  const centerX = current.x + current.width / 2;
  const centerY = current.y + current.height / 2;
  const x = Math.round(Math.min(workArea.x + workArea.width - width, Math.max(workArea.x, centerX - width / 2)));
  const y = Math.round(Math.min(workArea.y + workArea.height - height, Math.max(workArea.y, centerY - height / 2)));

  if (window.isMaximized()) window.unmaximize();
  if (window.isFullScreen()) window.setFullScreen(false);
  window.setBounds({ x, y, width, height }, true);
  return { width, height };
});

async function createWindow() {
  const liveMarker = path.join(process.resourcesPath, "caiguang-live");
  const baseLiveUrl = process.env.CAIGUANG_DEV_URL || (existsSync(liveMarker) ? "http://localhost:3000/?desktop=1" : undefined);
  const forceOnboarding = process.argv.includes("--onboarding");
  const liveUrl = baseLiveUrl ? new URL(baseLiveUrl) : undefined;
  if (liveUrl && forceOnboarding) liveUrl.searchParams.set("onboarding", "1");
  if (!liveUrl && !serverHandle) serverHandle = await startDesktopServer(appRoot, app.getPath("userData"));
  const window = new BrowserWindow({
    width: 1180, height: 760, minWidth: 680, minHeight: 480,
    title: "采光", backgroundColor: "#151722", titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: { preload: path.join(desktopDir, "preload.cjs"), contextIsolation: true, nodeIntegration: false },
  });
  mainWindow = window;
  window.on("closed", () => { if (mainWindow === window) mainWindow = undefined; });
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  const targetUrl = liveUrl || new URL(serverHandle.url);
  if (forceOnboarding) targetUrl.searchParams.set("onboarding", "1");
  await window.loadURL(targetUrl.toString());
  startLibraryWatcher();
}

app.setName("采光");
app.whenReady().then(async () => {
  await migrateLegacyData(app.getPath("userData"));
  await deliverPendingNotification();
  if (notificationOnlyLaunch) {
    setTimeout(() => app.quit(), 1_500).unref();
    return;
  }
  const runtimeNode = path.join(process.resourcesPath, "runtime", "node");
  const scheduler = path.join(process.resourcesPath, "runtime", "project", "scripts", "caiguang-scheduler.mjs");
  if (existsSync(runtimeNode) && existsSync(scheduler)) {
    await new Promise((resolve) => execFile(runtimeNode, [scheduler, "install"], {
      cwd: path.dirname(path.dirname(scheduler)),
      timeout: 20_000,
      env: { ...process.env, SHARP_EYE_HOME: app.getPath("userData") },
    }, () => resolve()));
  }
  const icon = nativeImage.createFromPath(path.join(appRoot, "assets", "app-icon.png"));
  if (process.platform === "darwin" && !icon.isEmpty()) app.dock.setIcon(icon);
  await createWindow();
}).catch((error) => dialog.showErrorBox("采光启动失败", error instanceof Error ? error.message : String(error)));
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  stopXhsLoginTimer();
  stopXhsChromeSync();
  if (xhsLoginResetTimer) clearTimeout(xhsLoginResetTimer);
  serverHandle?.close();
  libraryWatcher?.close();
  if (libraryChangeTimer) clearTimeout(libraryChangeTimer);
});
