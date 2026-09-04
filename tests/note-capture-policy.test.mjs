import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyNoteCaptureFailure,
  clearNoteFailure,
  MAX_NOTE_ATTEMPTS,
  noteTaskIsDue,
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

test("successful capture clears retry metadata", () => {
  const task = { status: "retry_pending", attempts: 2, nextAttemptAt: "later", failureType: "transient_network", error: "timeout" };
  clearNoteFailure(task);
  assert.equal(task.attempts, undefined);
  assert.equal(task.failureType, undefined);
  assert.equal(task.error, undefined);
});
