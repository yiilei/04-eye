import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("a newly verified pin queues its latest post and remains visible as verified", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-verify-pin-"));
  const dataDir = path.join(dataHome, "data");
  await mkdir(dataDir, { recursive: true });
  const profileId = "profile-new";
  const pending = { searchKey: profileId, xiaohongshuId: "red-new", displayName: "新账号", group: "manual_pending",
    profileId, profileUrl: `https://www.xiaohongshu.com/user/profile/${profileId}`, status: "pending_verification" };
  await Promise.all([
    writeFile(path.join(dataDir, "xhs-account-pins.json"), `${JSON.stringify({ version: 1, accounts: [] })}\n`),
    writeFile(path.join(dataDir, "xhs-pending-pins.json"), `${JSON.stringify({ schemaVersion: 1, accounts: [pending] })}\n`),
    writeFile(path.join(dataDir, "xhs-capture-queue.json"), `${JSON.stringify({ version: 1, checkedAccounts: [], tasks: [] })}\n`),
    writeFile(path.join(dataDir, "user-preferences.json"), `${JSON.stringify({ pinnedAccountIds: [profileId], manualPinAccounts: [pending] })}\n`),
  ]);
  const previousHome = process.env.SHARP_EYE_HOME;
  process.env.SHARP_EYE_HOME = dataHome;
  try {
    const { verifyPendingPins } = await import(`../scripts/xhs-verify-pins.mjs?first-capture=${Date.now()}`);
    const posts = JSON.stringify([{ id: "6aa900000000000000000001", xsecToken: "fresh-token", noteCard: {
      displayTitle: "刚发布的最新帖子", user: { nickName: "新账号", userId: profileId },
    } }, { id: "6aa800000000000000000001", noteCard: { displayTitle: "旧帖子", user: { nickName: "新账号", userId: profileId } } }]);
    const result = await verifyPendingPins({ write: true, xhsRunner: (args) => args[0] === "status" ? "{}" : posts });
    assert.equal(result.verified, 1);
    assert.equal(result.queued, 1);
    const pins = JSON.parse(await readFile(path.join(dataDir, "xhs-account-pins.json"), "utf8"));
    const queue = JSON.parse(await readFile(path.join(dataDir, "xhs-capture-queue.json"), "utf8"));
    const pendingAfter = JSON.parse(await readFile(path.join(dataDir, "xhs-pending-pins.json"), "utf8"));
    const preferences = JSON.parse(await readFile(path.join(dataDir, "user-preferences.json"), "utf8"));
    assert.equal(pins.accounts[0].lastSeenPostId, "6aa900000000000000000001");
    assert.deepEqual(queue.tasks.map((task) => ({ id: task.id, status: task.status, firstCaptureForPin: task.firstCaptureForPin })), [
      { id: "note-6aa900000000000000000001", status: "pending", firstCaptureForPin: true },
    ]);
    assert.match(queue.tasks[0].sourceUrl, /xsec_token=fresh-token/);
    assert.equal(pendingAfter.accounts.length, 0);
    assert.equal(preferences.manualPinAccounts[0].status, "verified");
    preferences.manualPinAccounts = [];
    await writeFile(path.join(dataDir, "user-preferences.json"), `${JSON.stringify(preferences)}\n`);
    const reconciled = await verifyPendingPins({ write: true, xhsRunner: () => { throw new Error("no request expected"); } });
    assert.equal(reconciled.checked, 0);
    const repairedPreferences = JSON.parse(await readFile(path.join(dataDir, "user-preferences.json"), "utf8"));
    assert.equal(repairedPreferences.manualPinAccounts[0].status, "verified");
  } finally {
    if (previousHome === undefined) delete process.env.SHARP_EYE_HOME;
    else process.env.SHARP_EYE_HOME = previousHome;
    await rm(dataHome, { recursive: true, force: true });
  }
});
