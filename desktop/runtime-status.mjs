export const latestReleaseUrl = "https://github.com/yiilei/04-eye/releases/latest";

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

export async function checkForUpdate({ currentVersion, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_000);
  try {
    const response = await fetchImpl(latestReleaseUrl, {
      headers: { Accept: "text/html", "User-Agent": "Caiguang" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releaseUrl = response.url || response.headers?.get?.("x-caiguang-final-url") || "";
    const match = releaseUrl.match(/^https:\/\/github\.com\/yiilei\/04-eye\/releases\/tag\/v([\d.]+)$/u);
    const latestVersion = match?.[1] || "";
    if (!versionParts(latestVersion)) throw new Error("发行版本号无效");
    return {
      state: compareVersions(latestVersion, currentVersion) > 0 ? "available" : "latest",
      currentVersion,
      latestVersion,
      releaseUrl,
      downloadUrl: `https://github.com/yiilei/04-eye/releases/download/v${latestVersion}/Caiguang-Full-Installer-macOS-arm64-v${latestVersion}.zip`,
      publishedAt: null,
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
