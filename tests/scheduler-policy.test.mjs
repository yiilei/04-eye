import assert from "node:assert/strict";
import test from "node:test";
import { captureIsDue, initialCaptureReady, pushIsDue, schedulerEnabled } from "../scripts/scheduler-policy.mjs";
import { initializeCapturePreferences, randomCaptureTime } from "../scripts/capture-time-policy.mjs";

test("fresh installs receive one stable random capture time between midnight and 09:00", () => {
  assert.equal(randomCaptureTime(() => 0), "00:00");
  assert.equal(randomCaptureTime(() => 0.5), "04:30");
  assert.equal(randomCaptureTime(() => 0.999999), "08:59");
  assert.deepEqual(initializeCapturePreferences({}, () => 0.25).preferences, {
    onboardingComplete: false,
    automaticCaptureEnabled: true,
    creatorH5CaptureEnabled: true,
    captureTime: "02:15",
    pushTime: "11:00",
  });
  assert.equal(initializeCapturePreferences({ captureTime: "06:42", pushTime: "10:00" }, () => 0).preferences.captureTime, "06:42");
  assert.equal(initializeCapturePreferences({ captureTime: "14:20", pushTime: "10:00" }, () => 0).preferences.captureTime, "14:20");
  assert.equal(schedulerEnabled(initializeCapturePreferences({}, () => 0).preferences), false);
});

const now = { date: "2026-08-24", time: "02:00" };
const ready = { initialCaptureCompletedAt: "2026-08-23T10:00:00.000Z" };

test("automatic work waits for the user to complete the first capture", () => {
  const preferences = { onboardingComplete: true, automaticCaptureEnabled: true, captureTime: "00:00", pushTime: "00:00" };
  assert.equal(schedulerEnabled(preferences), true);
  assert.equal(initialCaptureReady({}), false);
  assert.equal(captureIsDue(preferences, {}, now), false);
  assert.equal(pushIsDue(preferences, {}, now), false);
  assert.equal(captureIsDue(preferences, ready, now), true);
  assert.equal(pushIsDue(preferences, ready, now), true);
});

test("existing installations with a prior capture remain eligible after upgrade", () => {
  assert.equal(initialCaptureReady({ lastCaptureDate: "2026-08-23" }), true);
});

test("disabled switch blocks capture and push even when the clock matches", () => {
  const preferences = { automaticCaptureEnabled: false, captureTime: "02:00", pushTime: "02:00" };
  assert.equal(schedulerEnabled(preferences), false);
  assert.equal(captureIsDue(preferences, {}, now), false);
  assert.equal(pushIsDue(preferences, {}, now), false);
});

test("enabled switch allows due actions and prevents duplicate daily runs", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00", pushTime: "02:00" };
  assert.equal(schedulerEnabled(preferences), true);
  assert.equal(captureIsDue(preferences, ready, now), true);
  assert.equal(pushIsDue(preferences, ready, now), true);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: now.date }, now), false);
  assert.equal(pushIsDue(preferences, { lastPushDate: now.date }, now), false);
});

test("today's displayed random schedule controls the normal run", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00", pushTime: "11:00" };
  const state = { ...ready, captureScheduleDate: now.date, captureScheduleTime: "06:37" };
  assert.equal(captureIsDue(preferences, state, { date: now.date, time: "01:59" }), false);
  assert.equal(captureIsDue(preferences, state, { date: now.date, time: "06:36" }), false);
  assert.equal(captureIsDue(preferences, state, { date: now.date, time: "06:37" }), true);
});

test("an explicitly scheduled recovery retries after cooldown without waiting for today's random hour", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "08:00" };
  const state = { ...ready, lastCaptureStatus: "needs_attention", captureScheduleTime: "08:00", nextCaptureAttemptAt: "2026-08-24T01:30:00Z" };
  assert.equal(captureIsDue(preferences, state, { ...now, time: "07:29", timestamp: Date.parse("2026-08-24T01:29:00Z") }), false);
  assert.equal(captureIsDue(preferences, state, { ...now, time: "07:30", timestamp: Date.parse("2026-08-24T01:30:00Z") }), true);
});

test("failed runs catch up after cooldown, successful runs do not duplicate", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00" };
  const state = { ...ready, lastCaptureDate: now.date, lastCaptureStatus: "needs_attention", nextCaptureAttemptAt: "2026-08-24T04:30:00Z" };
  assert.equal(captureIsDue(preferences, state, { ...now, time: "12:29", timestamp: Date.parse("2026-08-24T04:29:00Z") }), false);
  assert.equal(captureIsDue(preferences, state, { ...now, time: "12:30", timestamp: Date.parse("2026-08-24T04:30:00Z") }), true);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: now.date, lastCaptureStatus: "completed" }, now), false);
});

test("a queued item cannot wake the full pipeline after the normal daily capture", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00", pushTime: "11:00" };
  const state = { ...ready, lastCaptureDate: now.date, captureScheduleTime: "02:00" };
  assert.equal(captureIsDue(preferences, state, now, true), false);
});

test("manual failure without an explicit cooldown does not create a background loop", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00" };
  const state = { ...ready, lastCaptureDate: now.date, lastCaptureStatus: "needs_attention", nextCaptureAttemptAt: null };
  assert.equal(captureIsDue(preferences, state, { ...now, time: "23:48" }), false);
});

test("a failed run waits until the next date after its one recovery attempt is exhausted", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "08:00" };
  const state = { ...ready, lastCaptureStatus: "needs_attention", captureFailureDate: "2026-08-23", nextCaptureAttemptAt: null };
  assert.equal(captureIsDue(preferences, state, { date: "2026-08-23", time: "23:59" }), false);
  assert.equal(captureIsDue(preferences, state, { date: "2026-08-24", time: "00:01" }), true);
});

test("missed schedules run once after wake or a later boot", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "02:00", pushTime: "11:00" };
  assert.equal(captureIsDue(preferences, ready, { date: now.date, time: "01:59" }), false);
  assert.equal(captureIsDue(preferences, ready, { date: now.date, time: "02:14" }), true);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: now.date }, { date: now.date, time: "18:00" }), false);
  assert.equal(pushIsDue(preferences, ready, { date: now.date, time: "10:59" }), false);
  assert.equal(pushIsDue(preferences, ready, { date: now.date, time: "11:20" }), true);
});

test("returning after days off catches up even before today's scheduled hour", () => {
  const preferences = { automaticCaptureEnabled: true, captureTime: "08:00" };
  assert.equal(captureIsDue(preferences, { lastCaptureDate: "2026-08-21", lastCaptureStatus: "completed" }, now), true);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: "2026-08-23", lastCaptureStatus: "completed" }, now), false);
  assert.equal(captureIsDue(preferences, { lastCaptureDate: now.date, lastCaptureStatus: "completed" }, now), false);
});
