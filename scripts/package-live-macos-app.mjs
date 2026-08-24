import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const sourceApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const outputDir = path.join(root, "release", "development");
const outputApp = path.join(outputDir, "采光·开发版.app");
const resources = path.join(outputApp, "Contents", "Resources");
const plist = path.join(outputApp, "Contents", "Info.plist");
const executable = "采光·开发版";
const iconset = path.join(outputDir, "caiguang-live.iconset");
const iconPng = path.join(root, "assets", "app-icon.png");
const iconFile = path.join(resources, "caiguang-live.icns");

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await cp(sourceApp, outputApp, { recursive: true, verbatimSymlinks: true });
await mkdir(iconset, { recursive: true });
for (const [pixels, name] of [[16,"icon_16x16.png"],[32,"icon_16x16@2x.png"],[32,"icon_32x32.png"],[64,"icon_32x32@2x.png"],[128,"icon_128x128.png"],[256,"icon_128x128@2x.png"],[256,"icon_256x256.png"],[512,"icon_256x256@2x.png"],[512,"icon_512x512.png"],[1024,"icon_512x512@2x.png"]]) {
  await exec("sips", ["-z", String(pixels), String(pixels), iconPng, "--out", path.join(iconset, name)]);
}
await exec("iconutil", ["-c", "icns", iconset, "-o", iconFile]);
await rename(path.join(outputApp, "Contents", "MacOS", "Electron"), path.join(outputApp, "Contents", "MacOS", executable));
for (const [key, value] of [["CFBundleDisplayName","采光·开发版"],["CFBundleName","采光·开发版"],["CFBundleExecutable",executable],["CFBundleIdentifier","com.yilei.caiguang.dev"],["CFBundleIconFile","caiguang-live.icns"]]) {
  await exec("plutil", ["-replace", key, "-string", value, plist]);
}
await rm(path.join(resources, "app"), { recursive: true, force: true });
await symlink(root, path.join(resources, "app"));
await writeFile(path.join(resources, "caiguang-live"), "连接当前采光源码与 localhost:3000\n");
await rm(iconset, { recursive: true, force: true });
console.log(outputApp);
