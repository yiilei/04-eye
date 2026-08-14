import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const electronApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
const releaseRoot = path.join(root, "release", "desktop");
const appPath = path.join(releaseRoot, "04的眼.app");
const resources = path.join(appPath, "Contents", "Resources");
const packagedApp = path.join(resources, "app");

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });
await cp(electronApp, appPath, { recursive: true, verbatimSymlinks: true });
await mkdir(packagedApp, { recursive: true });
for (const entry of ["desktop", "dist"]) await cp(path.join(root, entry), path.join(packagedApp, entry), { recursive: true });
await rm(path.join(packagedApp, "dist", "client", "review"), { recursive: true, force: true });
await writeFile(path.join(packagedApp, "package.json"), JSON.stringify({ name: "sharp-eye-04", version: "0.1.0", type: "module", main: "desktop/main.mjs" }, null, 2));

const plistPath = path.join(appPath, "Contents", "Info.plist");
await rename(path.join(appPath, "Contents", "MacOS", "Electron"), path.join(appPath, "Contents", "MacOS", "04的眼"));
await exec("plutil", ["-replace", "CFBundleDisplayName", "-string", "04的眼", plistPath]);
await exec("plutil", ["-replace", "CFBundleName", "-string", "04的眼", plistPath]);
await exec("plutil", ["-replace", "CFBundleExecutable", "-string", "04的眼", plistPath]);
await exec("plutil", ["-replace", "CFBundleIdentifier", "-string", "com.yilei.sharpeye04", plistPath]);
await exec("xattr", ["-cr", appPath]);
await exec("codesign", ["--force", "--deep", "--sign", "-", appPath]);
await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, path.join(releaseRoot, "04的眼-macOS-arm64.zip")]);
console.log(path.join(releaseRoot, "04的眼-macOS-arm64.zip"));
