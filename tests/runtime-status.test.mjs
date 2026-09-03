import test from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate, compareVersions } from "../desktop/runtime-status.mjs";
import { currentAppBundle, isTrustedUpdateDownload } from "../desktop/app-updater.mjs";

test("compares semantic app versions", () => {
  assert.equal(compareVersions("0.3.5", "0.3.4"), 1);
  assert.equal(compareVersions("v0.3.4", "0.3.4"), 0);
  assert.equal(compareVersions("0.3.3", "0.3.4"), -1);
});

test("reports an update from the release endpoint", async () => {
  const result = await checkForUpdate({
    currentVersion: "0.3.4",
    fetchImpl: async () => new Response("", { status: 200, headers: { "x-caiguang-final-url": "https://github.com/yiilei/04-eye/releases/tag/v0.3.5" } }),
  });
  assert.equal(result.state, "available");
  assert.equal(result.latestVersion, "0.3.5");
  assert.equal(result.downloadUrl, "https://github.com/yiilei/04-eye/releases/download/v0.3.5/Caiguang-Full-Installer-macOS-arm64-v0.3.5.zip");
});

test("accepts only the exact official full installer for one-click updates", () => {
  assert.equal(isTrustedUpdateDownload("https://github.com/yiilei/04-eye/releases/download/v0.3.33/Caiguang-Full-Installer-macOS-arm64-v0.3.33.zip", "0.3.33"), true);
  assert.equal(isTrustedUpdateDownload("https://example.com/Caiguang-Full-Installer-macOS-arm64-v0.3.33.zip", "0.3.33"), false);
  assert.equal(isTrustedUpdateDownload("https://github.com/yiilei/04-eye/releases/download/v0.3.34/Caiguang-Full-Installer-macOS-arm64-v0.3.34.zip", "0.3.33"), false);
  assert.equal(currentAppBundle("/Users/test/Applications/采光.app/Contents/MacOS/采光"), "/Users/test/Applications/采光.app");
});
