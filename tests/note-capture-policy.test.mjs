import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNoteCaptureFailure,
  clearNoteFailure,
  MAX_NOTE_ATTEMPTS,
  noteTaskIsDue,
  reconcileNoteTaskAccount,
  transitionNoteFailure,
} from "../scripts/note-capture-policy.mjs";

test("an explicit parser incompatibility requests browser capture without blacklisting account", () => {
  const task = { type: "note", status: "pending", accountKey: "account" };
  const result = transitionNoteFailure(task, "failed to extract note detail from NoteDetailMap", new Date("2026-08-24T10:00:00Z"));
  assert.equal(result.action, "browser_capture");
  assert.equal(task.status, "needs_browser_capture");
  assert.equal(task.failureType, "parser_incompatible");
  assert.equal("blacklisted" in task, false);
});

test("an empty downloader result is retried instead of mislabelled as parser incompatibility", () => {
  const task = { type: "note", status: "pending" };
  const result = transitionNoteFailure(task, "成功 0 个，失败 1 个", new Date("2026-09-04T02:00:00Z"));
  assert.equal(result.action, "retry");
  assert.equal(task.status, "retry_pending");
  assert.equal(task.failureType, "transient_network");
});

test("network failures use bounded retries before browser capture", () => {
  const task = { type: "note", status: "pending" };
  const first = transitionNoteFailure(task, "network timeout", new Date("2026-08-24T10:00:00Z"));
  assert.equal(first.action, "retry");
  assert.equal(task.status, "retry_pending");
  assert.equal(noteTaskIsDue(task, new Date("2026-08-24T10:01:00Z")), false);
  transitionNoteFailure(task, "network timeout", new Date(task.nextAttemptAt));
  const third = transitionNoteFailure(task, "network timeout", new Date(task.nextAttemptAt));
  assert.equal(task.attempts, MAX_NOTE_ATTEMPTS);
  assert.equal(third.action, "browser_capture");
  assert.equal(task.status, "needs_browser_capture");
});

test("login and verification failures require user action", () => {
  assert.equal(classifyNoteCaptureFailure("login_required").action, "user_action_required");
  assert.equal(classifyNoteCaptureFailure("需要验证码").action, "user_action_required");
});

test("browser and login failures require an explicit manual recovery instead of looping nightly", () => {
  const now = new Date("2026-09-07T01:00:00Z");
  for (const status of ["needs_browser_capture", "user_action_required", "failed"]) {
    assert.equal(noteTaskIsDue({ status }, now), false);
    assert.equal(noteTaskIsDue({ status }, now, { manual: true }), true);
  }
});

test("pausing an account pauses unfinished work and re-enabling reopens it", () => {
  const task = { type: "note", status: "retry_pending", accountKey: "red-id", attempts: 2, nextAttemptAt: "later" };
  const account = { profileId: "profile", status: "verified" };
  const paused = reconcileNoteTaskAccount(task, account, null, new Date("2026-09-15T01:00:00Z"), { enabled: false });
  assert.equal(paused.action, "pause");
  assert.equal(task.status, "account_paused");
  assert.equal(noteTaskIsDue(task, new Date(), { manual: true }), false);
  const resumed = reconcileNoteTaskAccount(task, account, null, new Date("2026-09-15T02:00:00Z"), { enabled: true });
  assert.equal(resumed.action, "reopened");
  assert.equal(task.status, "pending");
  assert.equal(task.attempts, undefined);
});

test("missing and pending accounts stop retry loops and recover without inflating attempts", () => {
  const task = { type: "note", status: "needs_browser_capture", accountKey: "orphan", attempts: 1527 };
  const first = reconcileNoteTaskAccount(task, null, null, new Date("2026-09-15T01:00:00Z"));
  assert.equal(first.action, "stop");
  assert.equal(task.status, "account_unavailable");
  assert.equal(task.attempts, MAX_NOTE_ATTEMPTS);
  const timestamp = task.lastAttemptAt;
  const second = reconcileNoteTaskAccount(task, null, null, new Date("2026-09-16T01:00:00Z"));
  assert.equal(second.changed, false);
  assert.equal(task.lastAttemptAt, timestamp);
  const waiting = reconcileNoteTaskAccount(task, null, { status: "pending_verification" }, new Date("2026-09-16T02:00:00Z"));
  assert.equal(waiting.action, "wait");
  assert.equal(task.status, "waiting_for_account_verification");
});

test("successful capture clears retry metadata", () => {
  const task = { status: "retry_pending", attempts: 2, nextAttemptAt: "later", failureType: "transient_network", error: "timeout" };
  clearNoteFailure(task);
  assert.equal(task.attempts, undefined);
  assert.equal(task.failureType, undefined);
  assert.equal(task.error, undefined);
});
