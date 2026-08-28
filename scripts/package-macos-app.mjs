import { existsSync } from "node:fs";
import { chmod, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const version = "0.3.17";
const bundledElectronApp = path.join(root, "node_modules", "electron", "dist", "Electron.app");
// Developer machines often prune Electron's binary after installation. Reuse a
// locally installed 采光 shell in that case; only this project's Resources/app
// payload is replaced below, so no user data or other applications are touched.
const electronApp = existsSync(bundledElectronApp)
  ? bundledElectronApp
  : path.join(os.homedir(), "Applications", "采光.app");
const releaseRoot = path.join(root, "release", "desktop");
const appPath = path.join(releaseRoot, "采光.app");
const resources = path.join(appPath, "Contents", "Resources");
const packagedApp = path.join(resources, "app");
const packagedRuntime = path.join(resources, "runtime");
const iconSvg = path.join(root, "assets", "app-icon.svg");
const iconset = path.join(releaseRoot, "caiguang.iconset");
const iconSource = path.join(releaseRoot, "caiguang-1024.png");
const iconFile = path.join(releaseRoot, "caiguang.icns");

if (!existsSync(electronApp)) throw new Error("未找到 Electron 外壳；请先安装采光或重新安装依赖。");

async function createMacIcon() {
  await mkdir(iconset, { recursive: true });
  await exec("sips", ["-s", "format", "png", iconSvg, "--out", iconSource]);
  const sizes = [
    [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
    [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
    [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
    [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
    [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
  ];
  for (const [pixels, filename] of sizes) {
    await exec("sips", ["-z", String(pixels), String(pixels), iconSource, "--out", path.join(iconset, filename)]);
  }
  await exec("iconutil", ["-c", "icns", iconset, "-o", iconFile]);
}

const sourceFilter = (source) => {
  const blocked = new Set([".git", ".venv", ".pytest_cache", "__pycache__", ".DS_Store", "Download"]);
  return !source.split(path.sep).some((part) => blocked.has(part)) && !source.endsWith(".pyc");
};

async function createCompletePackage() {
  const completeName = "采光-完整安装包";
  const completeRoot = path.join(releaseRoot, completeName);
  const sourceRoot = path.join(completeRoot, "Codex自动化与源代码");
  await mkdir(sourceRoot, { recursive: true });
  await cp(appPath, path.join(completeRoot, "采光.app"), { recursive: true, verbatimSymlinks: true });

  for (const entry of ["app", "assets", "build", "db", "desktop", "plugins", "scripts", "skills", "starter", "tests", "vendor", "worker"]) {
    await cp(path.join(root, entry), path.join(sourceRoot, entry), { recursive: true, verbatimSymlinks: true, filter: sourceFilter });
  }
  for (const entry of ["account-avatars", "brand"]) {
    await cp(path.join(root, "public", entry), path.join(sourceRoot, "public", entry), { recursive: true, filter: sourceFilter });
  }
  await cp(path.join(root, "public", "favicon.svg"), path.join(sourceRoot, "public", "favicon.svg"));
  for (const entry of [".agents", ".openai"]) {
    await cp(path.join(root, entry), path.join(sourceRoot, entry), { recursive: true, filter: sourceFilter });
  }

  for (const entry of [
    ".gitignore", "AGENTS.md", "AUTOMATION.md", "INSTALL_WITH_CODEX.md", "PROJECT-TODO.md", "README.md",
    "drizzle.config.ts", "eslint.config.mjs", "next-env.d.ts", "next.config.ts", "package.json",
    "pnpm-lock.yaml", "pnpm-workspace.yaml", "postcss.config.mjs", "tsconfig.json", "vite.config.ts",
  ]) {
    const source = path.join(root, entry);
    if (existsSync(source)) await cp(source, path.join(sourceRoot, entry));
  }

  await mkdir(path.join(sourceRoot, "data", "reports"), { recursive: true });
  await cp(path.join(root, "data", "xhs-account-pins.json"), path.join(sourceRoot, "data", "xhs-account-pins.json"));
  await cp(path.join(root, "data", "xhs-media-policy.json"), path.join(sourceRoot, "data", "xhs-media-policy.json"));
  await writeFile(path.join(sourceRoot, "data", "xhs-capture-queue.json"), `${JSON.stringify({
    schemaVersion: 1, createdAt: new Date().toISOString(), checkedAccounts: [], tasks: [],
  }, null, 2)}\n`);
  await writeFile(path.join(sourceRoot, "data", "generated-review-items.json"), "[]\n");

  const packageGuides = {
    "00-先看这里.md": "# 采光\n\n请先阅读 `Codex自动化与源代码/INSTALL_WITH_CODEX.md`，再打开采光.app。\n",
    "发给Codex.txt": "请阅读当前目录中 `Codex自动化与源代码/INSTALL_WITH_CODEX.md`，完成本地安装、登录与首次采集。\n",
    "开始安装.command": "#!/bin/zsh\nset -e\nbase_dir=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\nopen \"$base_dir/采光.app\"\n",
  };
  for (const [entry, fallback] of Object.entries(packageGuides)) {
    const source = path.join(root, "packaging", entry);
    const target = path.join(completeRoot, entry);
    if (existsSync(source)) await cp(source, target);
    else await writeFile(target, fallback);
  }
  await chmod(path.join(completeRoot, "开始安装.command"), 0o755);
  await writeFile(path.join(completeRoot, "版本信息.txt"), [
    `采光 ${version}`, "系统：macOS", "架构：Apple Silicon (arm64)",
    "包含：桌面应用、完整源代码、Codex Skill、采集与校验脚本、公开账号埋点、安装指引", "",
  ].join("\n"));

  const completeZip = path.join(releaseRoot, `${completeName}-macOS-arm64.zip`);
  await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", completeRoot, completeZip]);
  return completeZip;
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });
await createMacIcon();
await cp(electronApp, appPath, { recursive: true, verbatimSymlinks: true });
await mkdir(packagedApp, { recursive: true });
await mkdir(packagedRuntime, { recursive: true });
// Background capture must not reuse Electron as a Node substitute. Under
// launchd the Electron executable can remain stuck in framework bootstrap and
// prevent later scheduler ticks. Ship the same standalone Node executable that
// runs this packager so scheduled work is independent from Codex and Electron.
await cp(process.execPath, path.join(packagedRuntime, "node"));
await chmod(path.join(packagedRuntime, "node"), 0o755);
for (const entry of ["desktop", "dist", "starter"]) await cp(path.join(root, entry), path.join(packagedApp, entry), { recursive: true });
await rm(path.join(packagedApp, "dist", "client", "review"), { recursive: true, force: true });
await writeFile(path.join(packagedApp, "package.json"), JSON.stringify({ name: "caiguang", version, type: "module", main: "desktop/main.mjs" }, null, 2));
await cp(iconFile, path.join(resources, "caiguang.icns"));

const plistPath = path.join(appPath, "Contents", "Info.plist");
const macOSDir = path.join(appPath, "Contents", "MacOS");
const electronExecutable = path.join(macOSDir, "Electron");
const appExecutable = path.join(macOSDir, "采光");
if (existsSync(electronExecutable) && !existsSync(appExecutable)) await rename(electronExecutable, appExecutable);
await exec("plutil", ["-replace", "CFBundleDisplayName", "-string", "采光", plistPath]);
await exec("plutil", ["-replace", "CFBundleName", "-string", "采光", plistPath]);
await exec("plutil", ["-replace", "CFBundleExecutable", "-string", "采光", plistPath]);
await exec("plutil", ["-replace", "CFBundleIdentifier", "-string", "com.yilei.caiguang", plistPath]);
await exec("plutil", ["-replace", "CFBundleShortVersionString", "-string", version, plistPath]);
await exec("plutil", ["-replace", "CFBundleVersion", "-string", version, plistPath]);
await exec("plutil", ["-replace", "CFBundleIconFile", "-string", "caiguang.icns", plistPath]);
await exec("xattr", ["-cr", appPath]);
await exec("codesign", ["--force", "--deep", "--sign", "-", appPath]);

const appZip = path.join(releaseRoot, "采光-macOS-arm64.zip");
await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, appZip]);
const completeZip = await createCompletePackage();
await rm(iconset, { recursive: true, force: true });
await rm(iconSource, { force: true });
await rm(iconFile, { force: true });
console.log(JSON.stringify({ app: appZip, complete: completeZip }));
