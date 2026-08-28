import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const releaseApi = "https://api.github.com/repos/yiilei/04-eye/releases/latest";

function versionParts(value) {
  const normalized = String(value || "").trim().replace(/^v/i, "").split("-")[0];
  if (!/^\d+(?:\.\d+){0,2}$/.test(normalized)) return undefined;
  return normalized.split(".").map(Number);
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function findCodexCli({ home = os.homedir(), exists = existsSync } = {}) {
  const candidates = [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  return candidates.find((candidate) => exists(candidate));
}

export function getCodexStatus(options = {}) {
  const executable = findCodexCli(options);
  return {
    available: Boolean(executable),
    executable: executable || null,
    // Presence only: this deliberately never reads or exposes Codex auth data.
    authConfigured: options.exists ? options.exists(path.join(options.home || os.homedir(), ".codex", "auth.json")) : existsSync(path.join(options.home || os.homedir(), ".codex", "auth.json")),
  };
}

export async function checkForUpdate({ currentVersion, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetchImpl(releaseApi, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "Caiguang" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = await response.json();
    const latestVersion = String(release?.tag_name || "").replace(/^v/i, "");
    if (!versionParts(latestVersion)) throw new Error("发行版本号无效");
    return {
      state: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "latest",
      currentVersion,
      latestVersion,
      releaseUrl: typeof release?.html_url === "string" ? release.html_url : null,
      downloadUrl: (release?.assets || []).find((a) => a.name === `Caiguang-macOS-arm64-v${latestVersion}.zip`)?.browser_download_url || null,
      publishedAt: typeof release?.published_at === "string" ? release.published_at : null,
    };
  } catch (error) {
    return {
      state: "unavailable",
      currentVersion,
      message: error instanceof Error && error.name === "AbortError" ? "检查超时，请稍后再试" : "暂时无法检查更新",
    };
  } finally {
    clearTimeout(timeout);
  }
}
