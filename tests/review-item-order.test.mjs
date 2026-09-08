import test from "node:test";
import assert from "node:assert/strict";
import { reviewPublishedTimestamp, sortReviewItemsNewestFirst } from "../scripts/review-item-order.mjs";

test("review items sort by publication date instead of capture order", () => {
  const items = [
    { id: "old", publishedAt: "2026-08-01_12:00:00", capturedAt: "2026-09-07T10:00:00Z" },
    { id: "new", publishedAt: "2026-09-06_12:00:00", capturedAt: "2026-09-07T09:00:00Z" },
    { id: "event", date: "09-07 至 09-30", capturedAt: "2026-09-07T08:00:00Z" },
  ];
  assert.deepEqual(sortReviewItemsNewestFirst(items).map((item) => item.id), ["event", "new", "old"]);
});

test("post id timestamp remains a fallback for posts missing date metadata", () => {
  assert.ok(reviewPublishedTimestamp({ id: "note-6a9e6742000000000b00e9f2" }) > 0);
});

test("same-day posts retain their publication time and edited time beats an id fallback", () => {
  const items = [
    { id: "morning", publishedAt: "2026-09-07_08:15:00" },
    { id: "evening", publishedAt: "2026-09-07_20:45:00" },
  ];
  assert.deepEqual(sortReviewItemsNewestFirst(items).map((item) => item.id), ["evening", "morning"]);
  assert.equal(
    reviewPublishedTimestamp({ id: "note-ffffffff0000000000000000", editedAt: "2026-09-07_10:00:00" }),
    Date.parse("2026-09-07T10:00:00"),
  );
});
