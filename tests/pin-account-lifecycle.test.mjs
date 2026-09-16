import assert from "node:assert/strict";
import test from "node:test";
import { deletePinAccountState, resumedVerifiedAccountIds } from "../scripts/pin-account-lifecycle.mjs";

test("only an explicit resume of an existing verified account requests a fresh baseline", () => {
  const accounts = [
    { profileId: "profile-a", status: "verified" },
    { profileId: "profile-b", status: "verified" },
    { profileId: "profile-pending", status: "pending_verification" },
  ];
  assert.deepEqual(resumedVerifiedAccountIds({}, ["profile-a"], accounts), []);
  assert.deepEqual(resumedVerifiedAccountIds({ pinnedAccountIds: ["profile-a"] }, ["profile-a", "profile-b"], accounts), ["profile-b"]);
  assert.deepEqual(resumedVerifiedAccountIds({ pinnedAccountIds: ["profile-a"] }, ["profile-a", "profile-pending"], accounts), []);
  assert.deepEqual(resumedVerifiedAccountIds({ pinnedAccountIds: ["profile-a"], rebaselineOnResumeProfileIds: ["profile-b"] }, ["profile-a"], accounts), ["profile-b"]);
});

test("deleting an account removes its configuration and unfinished tasks but preserves history", () => {
  const account = { profileId: "profile-a", searchKey: "red-a", xiaohongshuId: "red-a" };
  const result = deletePinAccountState({
    preferences: { pinnedAccountIds: ["profile-a", "profile-b"], rebaselineOnResumeProfileIds: ["profile-a"], manualPinAccounts: [account] },
    pins: { version: 1, accounts: [account, { profileId: "profile-b", searchKey: "red-b" }] },
    pending: { schemaVersion: 1, accounts: [{ ...account, status: "pending_verification" }] },
    queue: { version: 1, tasks: [
      { id: "pending-a", type: "note", accountKey: "red-a", status: "account_paused" },
      { id: "history-a", type: "note", accountKey: "red-a", status: "completed" },
      { id: "pending-b", type: "note", accountKey: "red-b", status: "pending" },
    ] },
  }, "profile-a");
  assert.deepEqual(result.preferences.pinnedAccountIds, ["profile-b"]);
  assert.deepEqual(result.preferences.rebaselineOnResumeProfileIds, []);
  assert.deepEqual(result.preferences.manualPinAccounts, []);
  assert.deepEqual(result.preferences.deletedPinAccountIds, ["profile-a"]);
  assert.deepEqual(result.pins.accounts.map((item) => item.profileId), ["profile-b"]);
  assert.deepEqual(result.pending.accounts, []);
  assert.deepEqual(result.queue.tasks.map((item) => item.id), ["history-a", "pending-b"]);
  assert.equal(result.removedTaskCount, 1);
});

test("account deletion is repeatable after a partial or repeated request", () => {
  const first = deletePinAccountState({ preferences: {}, pins: {}, pending: {}, queue: {} }, "profile-a");
  const second = deletePinAccountState(first, "profile-a");
  assert.deepEqual(second.preferences.deletedPinAccountIds, ["profile-a"]);
  assert.equal(second.removedTaskCount, 0);
});
