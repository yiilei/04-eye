import { app, BrowserWindow, dialog, ipcMain, nativeImage, screen, shell } from "electron";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktopServer } from "./server.mjs";
import { migrateLegacyData } from "./data-migration.mjs";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(desktopDir, "..");
let serverHandle;
let mainWindow;
let xhsLoginTimer;

const captureConfigDir = () => path.join(app.getPath("userData"), "xhs-cli");
const captureCookieFile = () => path.join(captureConfigDir(), "cookies.json");

async function hasXhsCaptureLogin() {
  try {
    const saved = JSON.parse(await readFile(captureCookieFile(), "utf8"));
    const cookies = saved?.cookies || {};
    return Boolean(cookies.a1 && cookies.web_session);
  } catch {
    return false;
  }
}

function stopXhsLoginTimer() {
  if (xhsLoginTimer) clearInterval(xhsLoginTimer);
  xhsLoginTimer = undefined;
}

async function publishXhsLoginStatus() {
  const loggedIn = await hasXhsCaptureLogin();
  mainWindow?.webContents.send("caiguang:xhs-login-changed", { loggedIn });
  if (loggedIn) stopXhsLoginTimer();
  return { loggedIn };
}

function findCaptureEngine() {
  const candidates = [
    path.join(appRoot, "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    process.env.CAIGUANG_PROJECT_ROOT && path.join(process.env.CAIGUANG_PROJECT_ROOT, "vendor", "xhs-cli", ".venv", "bin", "xhs"),
    path.join(app.getPath("documents"), "ChatGPT", "小红书创作活动获取", "vendor", "xhs-cli", ".venv", "bin", "xhs"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function openXhsCaptureLogin() {
  if ((await publishXhsLoginStatus()).loggedIn) return { loggedIn: true };
  const executable = findCaptureEngine();
  if (!executable) {
    return { loggedIn: false, error: "未找到采光的小红书登录组件，请先运行完整安装。" };
  }
  await mkdir(captureConfigDir(), { recursive: true, mode: 0o700 });
  const helper = path.join(app.getPath("userData"), "采光-登录小红书.command");
  await writeFile(helper, [
    "#!/bin/zsh",
    "clear",
    "echo '正在同步 Chrome 中已登录的小红书会话…'",
    "echo '此操作只复制登录信息到采光本地，不会修改 Chrome，也不会自动弹出二维码。'",
    `export XHS_CLI_CONFIG_DIR=${shellQuote(captureConfigDir())}`,
    `${shellQuote(executable)} login --browser`,
    "exit_code=$?",
    "if [[ $exit_code -ne 0 ]]; then echo; echo '同步未完成：请先在 Chrome 登录小红书后重试。采光不会自动切换到扫码登录。'; read -k 1 '?按任意键关闭…'; fi",
    "exit $exit_code",
    "",
  ].join("\n"), { mode: 0o700 });
  await chmod(helper, 0o700);
  const openError = await shell.openPath(helper);
  if (openError) return { loggedIn: false, error: openError };
  stopXhsLoginTimer();
  xhsLoginTimer = setInterval(() => void publishXhsLoginStatus(), 1_000);
  return { loggedIn: false, loginStarted: true };
}

ipcMain.handle("caiguang:open-xhs-login", () => openXhsCaptureLogin());
ipcMain.handle("caiguang:xhs-login-status", () => publishXhsLoginStatus());

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
}

app.setName("采光");
app.whenReady().then(async () => {
  await migrateLegacyData(app.getPath("userData"));
  const icon = nativeImage.createFromPath(path.join(appRoot, "assets", "app-icon.png"));
  if (process.platform === "darwin" && !icon.isEmpty()) app.dock.setIcon(icon);
  await createWindow();
}).catch((error) => dialog.showErrorBox("采光启动失败", error instanceof Error ? error.message : String(error)));
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => {
  stopXhsLoginTimer();
  serverHandle?.close();
});
