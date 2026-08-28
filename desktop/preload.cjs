const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sharpEyeDesktop", {
  platform: "macOS",
  version: "0.3.17",
  fitWindow: (request) => ipcRenderer.invoke("caiguang:fit-window", request),
  getRuntimeStatus: () => ipcRenderer.invoke("caiguang:runtime-status"),
  checkForUpdate: () => ipcRenderer.invoke("caiguang:check-update"),
  openRelease: (url) => ipcRenderer.invoke("caiguang:open-release", url),
  downloadUpdate: (url) => ipcRenderer.invoke("caiguang:download-update", url),
  openXhsLogin: () => ipcRenderer.invoke("caiguang:open-xhs-login"),
  getXhsLoginStatus: () => ipcRenderer.invoke("caiguang:xhs-login-status"),
  onXhsLoginChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("caiguang:xhs-login-changed", listener);
    return () => ipcRenderer.removeListener("caiguang:xhs-login-changed", listener);
  },
  onLibraryChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("caiguang:library-changed", listener);
    return () => ipcRenderer.removeListener("caiguang:library-changed", listener);
  },
});
