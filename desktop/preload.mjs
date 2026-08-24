import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sharpEyeDesktop", {
  platform: "macOS",
  version: "0.3.0",
  fitWindow: (request) => ipcRenderer.invoke("caiguang:fit-window", request),
});
