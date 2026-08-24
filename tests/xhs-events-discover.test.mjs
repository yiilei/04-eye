import assert from "node:assert/strict";
import test from "node:test";
import { diffEvents } from "../scripts/xhs-events-discover.mjs";

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
