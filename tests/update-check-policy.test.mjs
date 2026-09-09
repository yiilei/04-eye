import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readUpdateStatus, recordUpdateCheck } from "../desktop/update-status-store.mjs";
import { updateCheckIsDue } from "../scripts/update-check-policy.mjs";

test("the nightly update check runs at 20:00 and catches up after a missed day", () => {
  assert.equal(updateCheckIsDue({}, { date: "2026-09-09", time: "19:59" }), false);
  assert.equal(updateCheckIsDue({}, { date: "2026-09-09", time: "20:00" }), true);
  assert.equal(updateCheckIsDue(
    { lastSuccessfulCheckDate: "2026-09-08" },
    { date: "2026-09-09", time: "08:00" },
  ), false);
  assert.equal(updateCheckIsDue(
    { lastSuccessfulCheckDate: "2026-09-07" },
    { date: "2026-09-09", time: "08:00" },
  ), true);
});

test("a failed nightly check retries once, then waits for another date", () => {
  const status = {
    schedulerAttemptDate: "2026-09-09",
    schedulerAttemptsToday: 1,
    schedulerNextAttemptAt: "2026-09-09T14:00:00.000Z",
  };
  assert.equal(updateCheckIsDue(status, {
    date: "2026-09-09", time: "21:59", timestamp: Date.parse("2026-09-09T13:59:00.000Z"),
  }), false);
  assert.equal(updateCheckIsDue(status, {
    date: "2026-09-09", time: "22:00", timestamp: Date.parse("2026-09-09T14:00:00.000Z"),
  }), true);
  assert.equal(updateCheckIsDue({ ...status, schedulerAttemptsToday: 2 }, {
    date: "2026-09-09", time: "23:59", timestamp: Date.parse("2026-09-09T15:59:00.000Z"),
  }), false);
});

test("cached update status preserves the available release for the app UI", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-update-status-"));
  try {
    await recordUpdateCheck(dataHome, {
      state: "available",
      currentVersion: "0.3.48",
      latestVersion: "0.3.49",
      releaseUrl: "https://github.com/yiilei/04-eye/releases/tag/v0.3.49",
      downloadUrl: "https://github.com/yiilei/04-eye/releases/download/v0.3.49/Caiguang-Full-Installer-macOS-arm64-v0.3.49.zip",
    }, {
      source: "scheduler",
      localDate: "2026-09-09",
      timestamp: Date.parse("2026-09-09T12:00:00.000Z"),
    });
    const cached = await readUpdateStatus(dataHome);
    assert.equal(cached.state, "available");
    assert.equal(cached.latestVersion, "0.3.49");
    assert.equal(cached.lastSuccessfulCheckDate, "2026-09-09");
    assert.equal(cached.schedulerNextAttemptAt, null);
  } finally {
    await rm(dataHome, { recursive: true, force: true });
  }
});
