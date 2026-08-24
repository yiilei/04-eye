import assert from "node:assert/strict";
import test from "node:test";
import { captureIsDue, pushIsDue, schedulerEnabled } from "../scripts/scheduler-policy.mjs";

const now = { date: "2026-08-24", time: "02:00" };

test("disabled switch blocks capture and push even when the clock matches", () => {
  const preferences = { automaticCaptureEnabled: false, captureTime: "02:00", pushTime: "02:00" };
  assert.equal(schedulerEnabled(preferences), false);
  assert.equal(captureIsDue(preferences, {}, now), false);
  assert.equal(pushIsDue(preferences, {}, now), false);
});

test("enabled switch allows due actions and prevents duplicate daily runs", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00", pushTime: "02:00" };
  assert.equal(schedulerEnabled(preferences), true);
  assert.equal(captureIsDue(preferences, {}, now), true);
  assert.equal(pushIsDue(preferences, {}, now), true);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: now.date }, now), false);
  assert.equal(pushIsDue(preferences, { lastPushDate: now.date }, now), false);
});
