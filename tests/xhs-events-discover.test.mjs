import assert from "node:assert/strict";
import test from "node:test";
import { diffEvents, firstCaptureEvents, migrateTaskUrls } from "../scripts/xhs-events-discover.mjs";

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

test("first capture selects the latest three creator-center activities", () => {
  const current = [
    ...events,
    { activityId: "older", title: "更早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=older" },
    { activityId: "oldest", title: "最早活动", sourceUrl: "https://creator.xiaohongshu.com/new/events#activity=oldest" },
  ];
  assert.deepEqual(firstCaptureEvents(current).map((item) => item.title), ["最新活动", "旧活动", "更早活动"]);
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
