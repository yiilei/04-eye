import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const note = (id) => ({ id, noteCard: { displayTitle: id } });

test("more than six batches survive interruption and resume without advancing the baseline early", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-discovery-backlog-"));
  const data = path.join(dataHome, "data");
  await mkdir(data, { recursive: true });
  const account = { status: "verified", searchKey: "account", xiaohongshuId: "red-id", displayName: "作者",
    profileId: "profile-id", profileUrl: "https://www.xiaohongshu.com/user/profile/profile-id", lastSeenPostId: "baseline" };
  await writeFile(path.join(data, "xhs-account-pins.json"), JSON.stringify({ accounts: [account] }));
  await writeFile(path.join(data, "xhs-capture-queue.json"), JSON.stringify({ schemaVersion: 1, checkedAccounts: [], tasks: [] }));
  await writeFile(path.join(data, "user-preferences.json"), JSON.stringify({ pinnedAccountIds: [account.profileId] }));
  const pages = Array.from({ length: 10 }, (_, page) => [note(`new-${page}`)]);
  pages[8].push(note("baseline"));
  const fixturePath = path.join(dataHome, "fixture.json");
  await writeFile(fixturePath, JSON.stringify({ account: {
    profile: { nickname: "作者", redId: "red-id", userId: "profile-id" }, posts: pages[0], backlogPages: pages,
  } }));
  const previousHome = process.env.SHARP_EYE_HOME;
  process.env.SHARP_EYE_HOME = dataHome;
  try {
    const { discover } = await import(`../scripts/xhs-discover.mjs?backlog=${Date.now()}`);
    const first = await discover({ fixture: fixturePath, write: true });
    assert.equal(first.checks[0].status, "backlog_incomplete");
    const firstBacklog = JSON.parse(await readFile(path.join(data, "xhs-discovery-backlog.json"), "utf8"));
    assert.equal(firstBacklog.accounts.account.scanDepth, 6);
    assert.equal(first.tasks.length, 0);
    assert.equal(first.checks[0].latestPostId, "baseline");

    const resumed = await discover({ fixture: fixturePath, write: true });
    assert.equal(resumed.checks[0].status, "verified");
    assert.equal(resumed.tasks.length, 9);
    const finishedBacklog = JSON.parse(await readFile(path.join(data, "xhs-discovery-backlog.json"), "utf8"));
    assert.equal(finishedBacklog.accounts.account, undefined);
  } finally {
    if (previousHome === undefined) delete process.env.SHARP_EYE_HOME;
    else process.env.SHARP_EYE_HOME = previousHome;
    await rm(dataHome, { recursive: true, force: true });
  }
});

test("a deleted or hidden baseline reaches an explicit manual-required state instead of looping six batches", async () => {
  const { nextBacklogScan } = await import("../scripts/xhs-discover.mjs");
  let state;
  for (let index = 0; index < 4; index += 1) {
    const plan = nextBacklogScan(state, "hidden-baseline");
    state = { baselineId: "hidden-baseline", scanDepth: plan.scanDepth, state: plan.state };
  }
  assert.deepEqual(state, { baselineId: "hidden-baseline", scanDepth: 24, state: "manual_required" });
  assert.equal(nextBacklogScan(state, "hidden-baseline").scan, false);
  assert.equal(nextBacklogScan(state, "hidden-baseline", { manual: true }).scanDepth, 30);
});

test("two consecutive timeouts stop the batch and recovery checks only unfinished accounts", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-discovery-timeout-"));
  const data = path.join(dataHome, "data");
  await mkdir(data, { recursive: true });
  const accounts = ["a", "b", "c", "d"].map((key) => ({ status: "verified", searchKey: key,
    xiaohongshuId: `red-${key}`, displayName: `作者${key}`, profileId: `profile-${key}`,
    profileUrl: `https://www.xiaohongshu.com/user/profile/profile-${key}` }));
  await writeFile(path.join(data, "xhs-account-pins.json"), JSON.stringify({ accounts }));
  await writeFile(path.join(data, "xhs-capture-queue.json"), JSON.stringify({ schemaVersion: 1, checkedAccounts: [], tasks: [] }));
  await writeFile(path.join(data, "user-preferences.json"), JSON.stringify({ pinnedAccountIds: accounts.map((account) => account.profileId) }));
  const previousHome = process.env.SHARP_EYE_HOME;
  const previousPacing = process.env.CAIGUANG_DISABLE_ACCOUNT_PACING;
  process.env.SHARP_EYE_HOME = dataHome;
  process.env.CAIGUANG_DISABLE_ACCOUNT_PACING = "1";
  try {
    const { discover } = await import(`../scripts/xhs-discover.mjs?timeouts=${Date.now()}`);
    const called = [];
    const payloadFor = (profileId) => {
      const key = profileId.replace("profile-", "");
      return JSON.stringify([{ id: `post-${key}`, noteCard: { displayTitle: `帖子${key}`,
        user: { nickName: `作者${key}`, userId: profileId } } }]);
    };
    const first = await discover({ write: true, firstLatest: true, xhsRunner: (args) => {
      const profileId = args[1];
      called.push(profileId);
      if (["profile-b", "profile-c"].includes(profileId)) throw new Error("spawnSync xhs ETIMEDOUT");
      return payloadFor(profileId);
    } });
    assert.equal(first.transientStopped, true);
    assert.deepEqual(called, ["profile-a", "profile-b", "profile-c"]);
    assert.deepEqual(first.checks.map((check) => check.status), [
      "verified", "discovery_failed", "discovery_failed", "deferred_transient_timeout",
    ]);

    const recoveredCalls = [];
    const recovered = await discover({ write: true, firstLatest: true, retryFailedOnly: true, xhsRunner: (args) => {
      recoveredCalls.push(args[1]);
      return payloadFor(args[1]);
    } });
    assert.deepEqual(recoveredCalls, ["profile-b", "profile-c", "profile-d"]);
    assert.equal(recovered.ok, true);
    assert.equal(recovered.total, 3);
    const queue = JSON.parse(await readFile(path.join(data, "xhs-capture-queue.json"), "utf8"));
    assert.equal(queue.checkedAccounts.length, 4);
    assert.equal(queue.checkedAccounts.every((check) => check.status === "verified"), true);
  } finally {
    if (previousHome === undefined) delete process.env.SHARP_EYE_HOME;
    else process.env.SHARP_EYE_HOME = previousHome;
    if (previousPacing === undefined) delete process.env.CAIGUANG_DISABLE_ACCOUNT_PACING;
    else process.env.CAIGUANG_DISABLE_ACCOUNT_PACING = previousPacing;
    await rm(dataHome, { recursive: true, force: true });
  }
});
