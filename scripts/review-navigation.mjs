export function indexAfterDecision(currentIndex, totalBeforeDecision) {
  const total = Math.max(0, Number(totalBeforeDecision) || 0);
  if (total <= 1) return 0;
  const index = Math.max(0, Math.floor(Number(currentIndex) || 0));
  // The decided item is removed by the desktop library refresh. Keeping the
  // same index selects the item that naturally slides into its place; only the
  // former last item wraps back to the beginning.
  return index >= total - 1 ? 0 : index;
}

export function reviewQueueItems(items, decisions = {}, dismissedIds = [], dismissalKey = (item) => item.id) {
  const dismissed = new Set(dismissedIds);
  const visible = items.filter((item) => !dismissed.has(dismissalKey(item)));
  const pending = visible.filter((item) => decisions[item.id] !== "kept" && decisions[item.id] !== "rejected");
  const reviewed = visible.filter((item) => decisions[item.id] === "kept" || decisions[item.id] === "rejected");
  return [...pending, ...reviewed];
}

export function nextPendingReviewId(items, decisions = {}, currentId = "") {
  const pending = items.filter((item) => decisions[item.id] !== "kept" && decisions[item.id] !== "rejected");
  if (!pending.length) return items[0]?.id || "";
  const currentIndex = pending.findIndex((item) => item.id === currentId);
  if (currentIndex < 0) return pending[0].id;
  if (pending.length === 1) return currentId;
  return pending[(currentIndex + 1) % pending.length].id;
}
