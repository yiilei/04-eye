import assert from "node:assert/strict";
import test from "node:test";
import { ensureDailyCaptureSchedule, randomCaptureTime } from "../scripts/capture-time-policy.mjs";

test("daily capture time spans the full midnight to 08:59 window", () => {
  assert.equal(randomCaptureTime(() => 0), "00:00");
  assert.equal(randomCaptureTime(() => 0.999999), "08:59");
});

test("daily schedule is stable for one date and changes on the next date", () => {
  const first = ensureDailyCaptureSchedule({}, "2026-09-04", () => 0.5);
  assert.equal(first.time, "04:30");
  assert.equal(first.changed, true);
  const same = ensureDailyCaptureSchedule(first.state, "2026-09-04", () => 0);
  assert.equal(same.time, "04:30");
  assert.equal(same.changed, false);
  const next = ensureDailyCaptureSchedule(first.state, "2026-09-05", () => 0);
  assert.equal(next.time, "00:00");
  assert.equal(next.changed, true);
});
