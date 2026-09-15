import assert from "node:assert/strict";
import test from "node:test";
import { selectDailyRetrySteps } from "../scripts/daily-retry-policy.mjs";

const steps = [
  ["cleanup_reviewed_media"],
  ["verify_pending_pins"],
  ["discover_creator_events"],
  ["discover_pinned_accounts"],
  ["capture_validate_report"],
];

test("a continuation runs only cleanup, the failed phase, and final processing", () => {
  assert.deepEqual(selectDailyRetrySteps(steps, true, "discover_creator_events").map((step) => step[0]), [
    "cleanup_reviewed_media", "discover_creator_events", "capture_validate_report",
  ]);
  assert.deepEqual(selectDailyRetrySteps(steps, true, "capture_validate_report").map((step) => step[0]), [
    "cleanup_reviewed_media", "capture_validate_report",
  ]);
  assert.deepEqual(selectDailyRetrySteps(steps, true, ["verify_pending_pins", "discover_pinned_accounts"]).map((step) => step[0]), [
    "cleanup_reviewed_media", "verify_pending_pins", "discover_pinned_accounts", "capture_validate_report",
  ]);
});

test("normal runs and legacy failures keep the complete flow", () => {
  assert.equal(selectDailyRetrySteps(steps, false, "discover_creator_events"), steps);
  assert.equal(selectDailyRetrySteps(steps, true, ""), steps);
});
