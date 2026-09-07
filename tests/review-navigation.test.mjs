import assert from "node:assert/strict";
import test from "node:test";
import { indexAfterDecision } from "../scripts/review-navigation.mjs";

test("decision keeps the same slot so the next item slides into place", () => {
  assert.equal(indexAfterDecision(0, 17), 0);
  assert.equal(indexAfterDecision(6, 17), 6);
});

test("decision on the last or only item wraps safely", () => {
  assert.equal(indexAfterDecision(16, 17), 0);
  assert.equal(indexAfterDecision(0, 1), 0);
  assert.equal(indexAfterDecision(4, 0), 0);
});
