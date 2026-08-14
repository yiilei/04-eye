import { app, BrowserWindow, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startDesktopServer } from "./server.mjs";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(desktopDir, "..");
let serverHandle;

async function createWindow() {
  if (!serverHandle) serverHandle = await startDesktopServer(appRoot);
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    title: "04的眼", backgroundColor: "#151722", titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: { preload: path.join(desktopDir, "preload.mjs"), contextIsolation: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  await window.loadURL(serverHandle.url);
}

app.setName("04的眼");
app.whenReady().then(createWindow).catch((error) => dialog.showErrorBox("04的眼启动失败", error instanceof Error ? error.message : String(error)));
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => serverHandle?.close());
