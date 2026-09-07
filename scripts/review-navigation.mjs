export function indexAfterDecision(currentIndex, totalBeforeDecision) {
  const total = Math.max(0, Number(totalBeforeDecision) || 0);
  if (total <= 1) return 0;
  const index = Math.max(0, Math.floor(Number(currentIndex) || 0));
  // The decided item is removed by the desktop library refresh. Keeping the
  // same index selects the item that naturally slides into its place; only the
  // former last item wraps back to the beginning.
  return index >= total - 1 ? 0 : index;
}
