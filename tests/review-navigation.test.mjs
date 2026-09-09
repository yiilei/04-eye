import assert from "node:assert/strict";
import test from "node:test";
import { indexAfterDecision, nextPendingReviewId, reviewQueueItems } from "../scripts/review-navigation.mjs";

test("decision keeps the same slot so the next item slides into place", () => {
  assert.equal(indexAfterDecision(0, 17), 0);
  assert.equal(indexAfterDecision(6, 17), 6);
});

test("decision on the last or only item wraps safely", () => {
  assert.equal(indexAfterDecision(16, 17), 0);
  assert.equal(indexAfterDecision(0, 1), 0);
  assert.equal(indexAfterDecision(4, 0), 0);
});

test("YES and NO move the reviewed item to the bottom and select the next pending item", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
  const afterYesDecisions = { first: "kept" };
  assert.equal(nextPendingReviewId(items, {}, "first"), "second");
  assert.deepEqual(reviewQueueItems(items, afterYesDecisions).map((item) => item.id), ["second", "third", "first"]);

  const afterNoDecisions = { first: "kept", second: "rejected" };
  assert.equal(nextPendingReviewId(items, afterYesDecisions, "second"), "third");
  assert.deepEqual(reviewQueueItems(items, afterNoDecisions).map((item) => item.id), ["third", "first", "second"]);
});

test("the former last pending item wraps to the first pending item", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
  assert.equal(nextPendingReviewId(items, {}, "third"), "first");
  assert.deepEqual(reviewQueueItems(items, { third: "kept" }).map((item) => item.id), ["first", "second", "third"]);
});

test("dismissed items stay hidden while completed decisions remain at the bottom", () => {
  const items = [{ id: "first", key: "a" }, { id: "second", key: "b" }, { id: "third", key: "c" }];
  assert.deepEqual(
    reviewQueueItems(items, { second: "kept" }, ["c"], (item) => item.key).map((item) => item.id),
    ["first", "second"],
  );
});

test("when the last pending item is reviewed it remains available at the bottom", () => {
  const items = [{ id: "first" }];
  assert.equal(nextPendingReviewId(items, {}, "first"), "first");
  assert.deepEqual(reviewQueueItems(items, { first: "rejected" }).map((item) => item.id), ["first"]);
});
