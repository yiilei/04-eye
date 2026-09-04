import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = process.cwd();
const version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version;
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
const packagedRuntimeProject = path.join(packagedRuntime, "project");
const bundledPythonRoot = process.env.CAIGUANG_PYTHON_ROOT
  || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python");
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

async function createCompletePackage() {
  const completeName = "采光-完整安装包";
  const completeRoot = path.join(releaseRoot, completeName);
  await mkdir(completeRoot, { recursive: true });
  // Preserve nested framework signatures and resource forks. fs.cp can lose
  // signature metadata when the complete installer is later archived.
  const completeApp = path.join(completeRoot, "采光.app");
  await exec("ditto", [appPath, completeApp]);
  // Seal the installer copy independently. Copying a deeply signed Electron
  // bundle can preserve files while invalidating nested framework seals.
  await exec("codesign", ["--force", "--deep", "--sign", "-", completeApp]);
  await exec("codesign", ["--verify", "--deep", "--strict", completeApp]);

  const packageGuides = {
    "00-先看这里.md": "# 采光\n\n双击 `开始安装.command`。采光已内置 MCP、采集器、下载器和定时任务，不需要外置源码或 Codex 运行。\n",
    "发给Codex.txt": "请将当前目录的采光.app安装到 ~/Applications 并打开。应用已内置所有本地运行组件。\n",
    "开始安装.command": "#!/bin/zsh\nset -e\nbase_dir=\"$(cd \"$(dirname \"$0\")\" && pwd)\"\napps_dir=\"$HOME/Applications\"\ntarget=\"$apps_dir/采光.app\"\nstaging=\"$apps_dir/.采光.installing.app\"\nbackup=\"$apps_dir/.采光.previous.app\"\nmkdir -p \"$apps_dir\"\nrm -rf \"$staging\" \"$backup\"\nditto \"$base_dir/采光.app\" \"$staging\"\ncodesign --verify --deep --strict \"$staging\"\nosascript -e 'tell application \"采光\" to quit' >/dev/null 2>&1 || true\n[[ -d \"$target\" ]] && mv \"$target\" \"$backup\"\nif ! mv \"$staging\" \"$target\"; then\n  [[ -d \"$backup\" ]] && mv \"$backup\" \"$target\"\n  exit 1\nfi\nopen \"$target\"\nrm -rf \"$backup\"\n",
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
    "包含：桌面应用、Node/Python 运行时、MCP、采集与校验脚本、下载器、公开账号埋点和定时任务", "",
  ].join("\n"));

  const completeZip = path.join(releaseRoot, `${completeName}-macOS-arm64.zip`);
  await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", completeRoot, completeZip]);
  return completeZip;
}

await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });
await createMacIcon();
await cp(electronApp, appPath, { recursive: true, verbatimSymlinks: true });
// When reusing an installed 采光 shell, remove its previous application
// payload before copying the fresh build. Recursive cp merges directories and
// would otherwise retain obsolete hashed chunks and retired IPC handlers.
await rm(packagedApp, { recursive: true, force: true });
await rm(packagedRuntime, { recursive: true, force: true });
await mkdir(packagedApp, { recursive: true });
await mkdir(packagedRuntime, { recursive: true });
// Background capture must not reuse Electron as a Node substitute. Under
// launchd the Electron executable can remain stuck in framework bootstrap and
// prevent later scheduler ticks. Ship the same standalone Node executable that
// runs this packager so scheduled work is independent from Codex and Electron.
await cp(process.execPath, path.join(packagedRuntime, "node"));
await chmod(path.join(packagedRuntime, "node"), 0o755);
// Codex's bundled Node keeps symbol data that scheduled capture never uses.
// Removing local symbols saves roughly 24 MB after installation; the whole
// application is signed again below, so the transformed binary remains valid.
await exec("strip", ["-x", path.join(packagedRuntime, "node")]);
if (!existsSync(bundledPythonRoot)) throw new Error("未找到可嵌入的 Python 3.12 运行时");
const pythonRuntimeFilter = (source) => !source.split(path.sep).includes("__pycache__") && !source.endsWith(".pyc");
await cp(bundledPythonRoot, path.join(packagedRuntime, "python"), { recursive: true, verbatimSymlinks: true, filter: pythonRuntimeFilter });
// The Codex Python distribution also contains document/spreadsheet/PDF tools
// (~286 MB) that 采光 never imports. Both capture engines carry isolated,
// complete environments, so the base runtime only needs the standard library.
await rm(path.join(packagedRuntime, "python", "lib", "python3.12", "site-packages"), { recursive: true, force: true });
await mkdir(path.join(packagedRuntime, "python", "lib", "python3.12", "site-packages"), { recursive: true });
for (const brokenLink of ["lib/pkgconfig/python3.pc", "lib/pkgconfig/python3-embed.pc", "share/man/man1/python3.1"]) {
  await rm(path.join(packagedRuntime, "python", brokenLink), { force: true });
}
const runtimeFilter = (source) => {
  const blocked = new Set([".git", ".pytest_cache", "__pycache__", ".DS_Store", "Download"]);
  return !source.split(path.sep).some((part) => blocked.has(part)) && !source.endsWith(".pyc");
};
for (const entry of ["data", "desktop", "plugins", "public", "scripts", "vendor"]) {
  await cp(path.join(root, entry), path.join(packagedRuntimeProject, entry), { recursive: true, verbatimSymlinks: true, filter: runtimeFilter });
}
await cp(path.join(root, "node_modules"), path.join(packagedRuntimeProject, "node_modules"), { recursive: true, verbatimSymlinks: true });
for (const entry of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"]) {
  await cp(path.join(root, entry), path.join(packagedRuntimeProject, entry));
}
// The embedded runtime executes capture scripts and the MCP server; it never
// builds the web app. Remove Electron, Cloudflare/workerd, TypeScript, Vite,
// linters, and other development-only packages before signing the bundle.
// Keeping production dependencies through pnpm's lockfile-aware prune is safer
// than maintaining a fragile hand-written allowlist of transitive packages.
await exec("pnpm", ["prune", "--prod", "--ignore-scripts"], {
  cwd: packagedRuntimeProject,
  env: { ...process.env, CI: "1" },
});
const { stdout: runtimeNodeModulesSize } = await exec("du", ["-sk", path.join(packagedRuntimeProject, "node_modules")]);
const runtimeNodeModulesKilobytes = Number.parseInt(runtimeNodeModulesSize, 10);
if (!Number.isFinite(runtimeNodeModulesKilobytes) || runtimeNodeModulesKilobytes > 100 * 1024) {
  throw new Error(`内置 Node 生产依赖异常膨胀：${runtimeNodeModulesKilobytes || "unknown"} KB`);
}
for (const engine of ["xhs-cli", "XHS-Downloader"]) {
  const bin = path.join(packagedRuntimeProject, "vendor", engine, ".venv", "bin");
  await rm(path.join(bin, "python"), { force: true });
  await rm(path.join(bin, "python3"), { force: true });
  await symlink("../../../../../python/bin/python3", path.join(bin, "python3"));
  await symlink("python3", path.join(bin, "python"));
}
// Installation/build tooling is not used after packaging. Removing it keeps
// the two isolated engines intact while avoiding ~45 MB of duplicate pip,
// compiler and upstream test payloads.
for (const relative of [
  "vendor/xhs-cli/.venv/lib/python3.12/site-packages/PyObjCTest",
  "vendor/xhs-cli/.venv/lib/python3.12/site-packages/Cython",
  "vendor/xhs-cli/.venv/lib/python3.12/site-packages/pip",
  "vendor/XHS-Downloader/.venv/lib/python3.12/site-packages/pip",
  "vendor/xhs-cli/tests",
]) await rm(path.join(packagedRuntimeProject, relative), { recursive: true, force: true });
// Editable installs record the absolute source checkout in a .pth file. The
// checkout is deliberately not shipped, so remove the stale pointer and make
// every launcher resolve modules from the embedded vendor directory instead.
await rm(path.join(packagedRuntimeProject, "vendor", "xhs-cli", ".venv", "lib", "python3.12", "site-packages", "_editable_impl_xhs_cli.pth"), { force: true });
const portableXhs = path.join(packagedRuntimeProject, "vendor", "xhs-cli", ".venv", "bin", "xhs");
await writeFile(portableXhs, "#!/bin/zsh\nset -e\nBIN_DIR=\"${0:A:h}\"\nXHS_ROOT=\"${BIN_DIR:h:h}\"\nexport PYTHONPATH=\"$XHS_ROOT${PYTHONPATH:+:$PYTHONPATH}\"\nexport PYTHONDONTWRITEBYTECODE=1\nexec \"$BIN_DIR/python\" -c 'from xhs_cli.cli import cli; cli()' \"$@\"\n");
await chmod(portableXhs, 0o755);
for (const entry of ["desktop", "dist", "starter"]) await cp(path.join(root, entry), path.join(packagedApp, entry), { recursive: true });
// desktop/server.mjs imports shared runtime modules. Keep every imported
// script in the app-only bundle as well as in the complete source bundle.
await mkdir(path.join(packagedApp, "scripts"), { recursive: true });
for (const script of ["review-cache-cleanup.mjs", "capture-time-policy.mjs"]) {
  await cp(path.join(root, "scripts", script), path.join(packagedApp, "scripts", script));
}
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
// `strip` invalidates the copied Node executable's original signature. A
// standalone file is not re-signed by `codesign --deep` consistently, so sign
// it explicitly before sealing the outer application bundle.
await exec("codesign", ["--force", "--sign", "-", path.join(packagedRuntime, "node")]);
await exec("codesign", ["--force", "--deep", "--sign", "-", appPath]);

const appZip = path.join(releaseRoot, "采光-macOS-arm64.zip");
await exec("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, appZip]);
const completeZip = await createCompletePackage();
await rm(iconset, { recursive: true, force: true });
await rm(iconSource, { force: true });
await rm(iconFile, { force: true });
console.log(JSON.stringify({ app: appZip, complete: completeZip, runtimeNodeModulesKilobytes }));
