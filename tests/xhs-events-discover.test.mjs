import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { diffEvents, firstCaptureEvents, migrateTaskUrls } from "../scripts/xhs-events-discover.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const discoveryScript = path.join(root, "scripts", "xhs-events-discover.mjs");

const events = [
  { activityId: "latest", title: "最新活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=latest" },
  { activityId: "old", title: "旧活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=old" },
];

test("first creator-center check establishes a baseline without backfilling", () => {
  const result = diffEvents(events, { initializedAt: null, knownEventIds: [] });
  assert.equal(result.current.length, 2);
  assert.equal(result.newEvents.length, 0);
});

test("later creator-center checks return only unseen activities", () => {
  const baseline = diffEvents(events.slice(1), { initializedAt: null, knownEventIds: [] });
  const result = diffEvents(events, { initializedAt: "2026-08-24T00:00:00.000Z", knownEventIds: baseline.current.map((item) => item.id) });
  assert.deepEqual(result.newEvents.map((item) => item.title), ["最新活动"]);
});

test("creator activities deduplicate by ID but retain different activities with the same title", () => {
  const result = diffEvents([
    { activityId: "same-id", title: "同名活动", sourceUrl: "https://creator.xiaohongshu.com/new/events" },
    { activityId: "same-id", title: "同名活动", sourceUrl: "https://fe.xiaohongshu.com/barleypromotion/vincent/same-id" },
    { activityId: "different-id", title: "同名活动", sourceUrl: "https://fe.xiaohongshu.com/barleypromotion/vincent/different-id" },
  ], { initializedAt: "2026-09-07T00:00:00.000Z", knownEventIds: [] });
  assert.equal(result.current.length, 2);
  assert.equal(result.current[0].sourceUrl.includes("barleypromotion"), true);
  assert.deepEqual(result.current.map((item) => item.id), ["same-id", "different-id"]);
});

test("first capture selects the latest three creator-center activities", () => {
  const current = [
    ...events,
    { activityId: "older", title: "更早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=older" },
    { activityId: "oldest", title: "最早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=oldest" },
  ];
  assert.deepEqual(firstCaptureEvents(current).map((item) => item.title), ["最新活动", "旧活动", "更早活动"]);
});

test("isolated first capture writes three tasks once and later adds only unseen activities", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-first-events-"));
  const fixturePath = path.join(temporary, "events.json");
  const runDiscovery = (first = false) => spawnSync(process.execPath, [
    discoveryScript, "--write", "--fixture", fixturePath, ...(first ? ["--first-latest"] : []),
  ], { cwd: root, encoding: "utf8", env: { ...process.env, SHARP_EYE_HOME: temporary } });
  try {
    const initial = [
      ...events,
      { activityId: "older", title: "更早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=older" },
      { activityId: "oldest", title: "最早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=oldest" },
    ];
    await writeFile(fixturePath, `${JSON.stringify({ ok: true, events: initial })}\n`);
    assert.equal(runDiscovery(true).status, 0);
    assert.equal(runDiscovery(true).status, 0, "首次失败后的重试不应重复插入任务");
    let queue = JSON.parse(await readFile(path.join(temporary, "data", "xhs-capture-queue.json"), "utf8"));
    assert.deepEqual(queue.tasks.map((task) => task.title), ["最新活动", "旧活动", "更早活动"]);
    const state = JSON.parse(await readFile(path.join(temporary, "data", "xhs-events-state.json"), "utf8"));
    assert.equal(state.knownEventIds.length, 4, "未抓取的旧活动也应成为基线");

    await writeFile(fixturePath, `${JSON.stringify({ ok: true, events: [
      { activityId: "newest", title: "后来新增", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=newest" },
      ...initial,
    ] })}\n`);
    assert.equal(runDiscovery(false).status, 0);
    queue = JSON.parse(await readFile(path.join(temporary, "data", "xhs-capture-queue.json"), "utf8"));
    assert.deepEqual(queue.tasks.map((task) => task.title), ["最新活动", "旧活动", "更早活动", "后来新增"]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("published activity route migrates an old fallback task", () => {
  const tasks = [{ id: "h5-ed55", status: "fallback_pending", sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/ed55" , attempts: 3, error: "旧地址" }];
  migrateTaskUrls(tasks, [{ id: "ed55", detailResolution: "resolved", sourceUrl: "https://fe.xiaohongshu.com/barleypromotion/vincent/ed55?resource_instance_id=323238" }]);
  assert.equal(tasks[0].sourceUrl.includes("barleypromotion"), true);
  assert.equal(tasks[0].status, "needs_h5_capture");
  assert.equal("attempts" in tasks[0], false);
});

test("migration never reopens completed or user-dismissed tasks", () => {
  for (const status of ["completed", "rejected", "deleted", "skipped"]) {
    const task = { id: "h5-ed55", status, sourceUrl: "old", attempts: 2 };
    const snapshot = structuredClone(task);
    migrateTaskUrls([task], [{ id: "ed55", detailResolution: "resolved", sourceUrl: "https://fe.xiaohongshu.com/barleypromotion/vincent/ed55" }]);
    assert.deepEqual(task, snapshot);
  }
});

test("migration rejects guessed, mismatched and untrusted URLs", () => {
  for (const event of [
    { id: "ed55", sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/ed55" },
    { id: "ed55", detailResolution: "resolved", sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/other" },
    { id: "ed55", detailResolution: "resolved", sourceUrl: "https://evil.example/ditto/vincent/ed55" },
  ]) {
    const task = { id: "h5-ed55", status: "fallback_pending", sourceUrl: "old" };
    migrateTaskUrls([task], [event]);
    assert.equal(task.sourceUrl, "old");
  }
});
