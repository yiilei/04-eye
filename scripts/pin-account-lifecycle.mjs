const FINISHED_TASK_STATUSES = new Set(["completed", "rejected", "deleted", "skipped"]);

const profileIdFrom = (account) => String(account?.profileId
  || account?.profileUrl?.match(/\/user\/profile\/([^/?#]+)/)?.[1]
  || "");

const accountKeys = (account) => [account?.profileId, account?.searchKey, account?.xiaohongshuId]
  .map((value) => String(value || "")).filter(Boolean);

export function deletePinAccountState(state, profileId) {
  const targetId = String(profileId || "");
  const preferences = { ...(state.preferences || {}) };
  const pins = { ...(state.pins || {}), accounts: [...(state.pins?.accounts || [])] };
  const pending = { ...(state.pending || {}), accounts: [...(state.pending?.accounts || [])] };
  const queue = { ...(state.queue || {}), tasks: [...(state.queue?.tasks || [])] };
  const matchingAccounts = [
    ...(preferences.manualPinAccounts || []),
    ...pins.accounts,
    ...pending.accounts,
  ].filter((account) => profileIdFrom(account) === targetId);
  const keys = new Set([targetId, ...matchingAccounts.flatMap(accountKeys)].filter(Boolean));

  preferences.pinnedAccountIds = (preferences.pinnedAccountIds || []).map(String).filter((id) => id !== targetId);
  preferences.manualPinAccounts = (preferences.manualPinAccounts || []).filter((account) => profileIdFrom(account) !== targetId);
  preferences.deletedPinAccountIds = [...new Set([...(preferences.deletedPinAccountIds || []).map(String), targetId])];
  pins.accounts = pins.accounts.filter((account) => profileIdFrom(account) !== targetId);
  pending.accounts = pending.accounts.filter((account) => profileIdFrom(account) !== targetId);

  let removedTaskCount = 0;
  queue.tasks = queue.tasks.filter((task) => {
    if (task.type !== "note" || !keys.has(String(task.accountKey || "")) || FINISHED_TASK_STATUSES.has(task.status)) return true;
    removedTaskCount += 1;
    return false;
  });
  return { preferences, pins, pending, queue, removedTaskCount };
}
