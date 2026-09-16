import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the real pipeline pauses and resumes queued work with the account switch", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-pin-pause-"));
  const data = path.join(temporary, "data");
  await mkdir(data, { recursive: true });
  const account = { searchKey: "red-a", xiaohongshuId: "red-a", displayName: "账号 A", group: "manual",
    profileId: "profile-a", profileUrl: "https://www.xiaohongshu.com/user/profile/profile-a",
    lastSeenPostId: "post-old", lastCheckedAt: "2026-09-15T00:00:00Z", status: "verified" };
  const queuePath = path.join(data, "xhs-capture-queue.json");
  const run = (extra = ["--dry-run"]) => spawnSync(process.execPath, [path.join(root, "scripts", "daily-pipeline.mjs"), ...extra, "--skip-build"],
    { cwd: root, encoding: "utf8", env: { ...process.env, SHARP_EYE_HOME: temporary } });
  try {
    await writeFile(queuePath, `${JSON.stringify({ schemaVersion: 1, checkedAccounts: [], tasks: [
      { id: "note-a", type: "note", status: "pending", accountKey: "red-a", title: "帖子 A", slug: "note-a",
        sourceUrl: "https://www.xiaohongshu.com/explore/post-a" },
    ] })}\n`);
    await writeFile(path.join(data, "xhs-account-pins.json"), `${JSON.stringify({ version: 1, accounts: [account] })}\n`);
    await writeFile(path.join(data, "xhs-pending-pins.json"), `${JSON.stringify({ schemaVersion: 1, accounts: [] })}\n`);
    await writeFile(path.join(data, "user-preferences.json"), `${JSON.stringify({ pinnedAccountIds: [] })}\n`);
    await writeFile(path.join(data, "xhs-media-policy.json"), await readFile(path.join(root, "data", "xhs-media-policy.json")));
    const pausedRun = run();
    assert.equal(pausedRun.status, 0, pausedRun.stderr || pausedRun.stdout);
    let queue = JSON.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.tasks[0].status, "account_paused");
    await writeFile(path.join(data, "user-preferences.json"), `${JSON.stringify({ pinnedAccountIds: ["profile-a"] })}\n`);
    const resumedRun = run();
    assert.equal(resumedRun.status, 0, resumedRun.stderr || resumedRun.stdout);
    queue = JSON.parse(await readFile(queuePath, "utf8"));
    assert.equal(queue.tasks[0].status, "pending");
    queue.tasks[0].status = "retry_pending";
    queue.tasks[0].nextAttemptAt = "2099-01-01T00:00:00Z";
    queue.checkedAccounts = [{ accountKey: "red-a", status: "verified", latestPostId: "post-new", checkedAt: "2026-09-16T00:00:00Z" }];
    await writeFile(queuePath, `${JSON.stringify(queue)}\n`);
    const checkpointRun = run([]);
    assert.equal(checkpointRun.status, 0, checkpointRun.stderr || checkpointRun.stdout);
    const pins = JSON.parse(await readFile(path.join(data, "xhs-account-pins.json"), "utf8"));
    assert.equal(pins.accounts[0].lastSeenPostId, "post-new", "queued retry work must not keep the discovery baseline stale");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
