import assert from "node:assert/strict";
import test from "node:test";
import { deletePinAccountState } from "../scripts/pin-account-lifecycle.mjs";

test("deleting an account removes its configuration and unfinished tasks but preserves history", () => {
  const account = { profileId: "profile-a", searchKey: "red-a", xiaohongshuId: "red-a" };
  const result = deletePinAccountState({
    preferences: { pinnedAccountIds: ["profile-a", "profile-b"], manualPinAccounts: [account] },
    pins: { version: 1, accounts: [account, { profileId: "profile-b", searchKey: "red-b" }] },
    pending: { schemaVersion: 1, accounts: [{ ...account, status: "pending_verification" }] },
    queue: { version: 1, tasks: [
      { id: "pending-a", type: "note", accountKey: "red-a", status: "account_paused" },
      { id: "history-a", type: "note", accountKey: "red-a", status: "completed" },
      { id: "pending-b", type: "note", accountKey: "red-b", status: "pending" },
    ] },
  }, "profile-a");
  assert.deepEqual(result.preferences.pinnedAccountIds, ["profile-b"]);
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
