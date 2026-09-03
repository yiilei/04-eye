import { createWriteStream } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { checkForUpdate } from "./runtime-status.mjs";

const exec = promisify(execFile);

export function isTrustedUpdateDownload(url, version) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:"
      && parsed.hostname === "github.com"
      && parsed.pathname === `/yiilei/04-eye/releases/download/v${version}/Caiguang-Full-Installer-macOS-arm64-v${version}.zip`;
  } catch { return false; }
}

export function currentAppBundle(executable = process.execPath) {
  const candidate = path.resolve(executable, "../../..");
  return candidate.endsWith(".app") ? candidate : null;
}

export async function prepareUpdate({ currentVersion, targetApp, fetchImpl = fetch, notify = () => {} }) {
  const release = await checkForUpdate({ currentVersion, fetchImpl });
  if (release.state !== "available") return release;
  if (!release.downloadUrl || !isTrustedUpdateDownload(release.downloadUrl, release.latestVersion)) {
    throw new Error("最新版本缺少可信的完整安装包");
  }
  if (!targetApp?.endsWith(".app")) throw new Error("无法确认当前应用位置");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-update-"));
  const archive = path.join(temporary, "update.zip");
  const extracted = path.join(temporary, "extracted");
  try {
    notify({ state: "downloading", percent: 1, message: "正在下载新版本" });
    const response = await fetchImpl(release.downloadUrl, { headers: { "User-Agent": "Caiguang-Updater" }, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`下载失败（${response.status}）`);
    const total = Number(response.headers.get("content-length")) || 0;
    let received = 0;
    const stream = Readable.fromWeb(response.body).map((chunk) => {
      received += chunk.length;
      notify({ state: "downloading", percent: total ? Math.min(95, Math.round(received / total * 95)) : 20, message: "正在下载新版本" });
      return chunk;
    });
    await pipeline(stream, createWriteStream(archive));
    notify({ state: "installing", percent: 96, message: "正在校验安装包" });
    await exec("ditto", ["-x", "-k", archive, extracted]);
    const stagedApp = path.join(extracted, "采光-完整安装包", "采光.app");
    await exec("codesign", ["--verify", "--deep", "--strict", stagedApp]);
    const { stdout: identifier } = await exec("defaults", ["read", path.join(stagedApp, "Contents", "Info.plist"), "CFBundleIdentifier"]);
    const { stdout: stagedVersion } = await exec("defaults", ["read", path.join(stagedApp, "Contents", "Info.plist"), "CFBundleShortVersionString"]);
    if (identifier.trim() !== "com.yilei.caiguang" || stagedVersion.trim() !== release.latestVersion) throw new Error("安装包身份或版本校验失败");

    const helper = path.join(temporary, "install-update.zsh");
    await writeFile(helper, `#!/bin/zsh\nset -eu\ntarget="$1"\nsource_app="$2"\npid="$3"\nbackup="${targetApp}.previous-update"\nstaging="${targetApp}.installing"\nwhile kill -0 "$pid" 2>/dev/null; do sleep 1; done\nrm -rf "$staging" "$backup"\nditto "$source_app" "$staging"\n[[ -d "$target" ]] && mv "$target" "$backup"\nif mv "$staging" "$target" && codesign --verify --deep --strict "$target"; then\n  open "$target"\n  rm -rf "$backup" "${temporary}"\nelse\n  rm -rf "$target" "$staging"\n  [[ -d "$backup" ]] && mv "$backup" "$target" && open "$target"\nfi\n`);
    await chmod(helper, 0o700);
    return { ...release, state: "ready", helper, stagedApp, targetApp, temporary };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function launchPreparedUpdate(prepared, pid = process.pid) {
  const child = spawn("/bin/zsh", [prepared.helper, prepared.targetApp, prepared.stagedApp, String(pid)], { detached: true, stdio: "ignore" });
  child.unref();
}
