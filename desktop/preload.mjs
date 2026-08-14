import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("sharpEyeDesktop", { platform: "macOS", version: "0.1.0" });
