import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, compareVersions, getCodexStatus } from "../desktop/runtime-status.mjs";

test("compares semantic app versions", () => {
  assert.equal(compareVersions("0.3.5", "0.3.4"), 1);
  assert.equal(compareVersions("v0.3.4", "0.3.4"), 0);
  assert.equal(compareVersions("0.3.3", "0.3.4"), -1);
});

test("reports an update from the release endpoint", async () => {
  const result = await checkForUpdate({
    currentVersion: "0.3.4",
    fetchImpl: async () => new Response(JSON.stringify({
      tag_name: "v0.3.5", html_url: "https://example.test/release", published_at: "2026-08-26T00:00:00Z",
      assets: [{ name: "Caiguang-Full-Installer-macOS-arm64-v0.3.5.zip", browser_download_url: "https://example.test/full.zip" }],
    }), { status: 200 }),
  });
  assert.equal(result.state, "available");
  assert.equal(result.latestVersion, "0.3.5");
  assert.equal(result.downloadUrl, "https://example.test/full.zip");
});

test("detects Codex without reading authentication content", () => {
  const existing = new Set(["/Applications/Codex.app/Contents/Resources/codex", "/tmp/home/.codex/auth.json"]);
  const result = getCodexStatus({ home: "/tmp/home", exists: (value) => existing.has(value) });
  assert.equal(result.available, true);
  assert.equal(result.authConfigured, true);
});
