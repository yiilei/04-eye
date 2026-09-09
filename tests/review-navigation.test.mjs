import assert from "node:assert/strict";
import test from "node:test";
import { indexAfterDecision, pendingReviewItems } from "../scripts/review-navigation.mjs";

test("decision keeps the same slot so the next item slides into place", () => {
  assert.equal(indexAfterDecision(0, 17), 0);
  assert.equal(indexAfterDecision(6, 17), 6);
});

test("decision on the last or only item wraps safely", () => {
  assert.equal(indexAfterDecision(16, 17), 0);
  assert.equal(indexAfterDecision(0, 1), 0);
  assert.equal(indexAfterDecision(4, 0), 0);
});

test("YES and NO immediately reveal the next pending item", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
  const before = pendingReviewItems(items);
  const firstNextIndex = indexAfterDecision(0, before.length);
  const afterYes = pendingReviewItems(items, { first: "kept" });
  assert.equal(afterYes[firstNextIndex].id, "second");

  const secondNextIndex = indexAfterDecision(0, afterYes.length);
  const afterNo = pendingReviewItems(items, { first: "kept", second: "rejected" });
  assert.equal(afterNo[secondNextIndex].id, "third");
});

test("the former last item wraps to the first pending item", () => {
  const items = [{ id: "first" }, { id: "second" }, { id: "third" }];
  const nextIndex = indexAfterDecision(2, items.length);
  const after = pendingReviewItems(items, { third: "kept" });
  assert.equal(after[nextIndex].id, "first");
});

test("dismissed items and completed decisions stay out of the pending list", () => {
  const items = [{ id: "first", key: "a" }, { id: "second", key: "b" }, { id: "third", key: "c" }];
  assert.deepEqual(
    pendingReviewItems(items, { second: "kept" }, ["c"], (item) => item.key).map((item) => item.id),
    ["first"],
  );
});
