const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sharpEyeDesktop", {
  platform: "macOS",
  version: "0.3.1",
  fitWindow: (request) => ipcRenderer.invoke("caiguang:fit-window", request),
  openXhsLogin: () => ipcRenderer.invoke("caiguang:open-xhs-login"),
  getXhsLoginStatus: () => ipcRenderer.invoke("caiguang:xhs-login-status"),
  onXhsLoginChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("caiguang:xhs-login-changed", listener);
    return () => ipcRenderer.removeListener("caiguang:xhs-login-changed", listener);
  },
});
