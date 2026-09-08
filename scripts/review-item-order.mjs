function parseDate(value, fallbackYear) {
  const clean = String(value || "").trim().replace(/^(?:编辑于|发布于)\s*/u, "");
  if (!clean) return 0;
  // Preserve the time and timezone carried by ISO timestamps. Date-only
  // strings are handled below in UTC so sorting does not shift across zones.
  const normalized = clean.replace(/_(?=\d{2}:\d{2})/u, "T");
  if (/^20\d{2}-\d{2}-\d{2}[T\s]/u.test(normalized)) {
    const timestamp = Date.parse(normalized);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  const full = clean.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/u);
  if (full) return Date.UTC(Number(full[1]), Number(full[2]) - 1, Number(full[3]));
  const short = clean.match(/(?:^|\s)(\d{1,2})[-/.月](\d{1,2})(?:日|\s|$)/u);
  if (short && fallbackYear) return Date.UTC(fallbackYear, Number(short[1]) - 1, Number(short[2]));
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function reviewPublishedTimestamp(item) {
  const captured = parseDate(item?.capturedAt);
  const fallbackYear = captured ? new Date(captured).getUTCFullYear() : new Date().getFullYear();
  const published = parseDate(item?.publishedAt, fallbackYear);
  if (published) return published;
  const activityDate = parseDate(item?.date, fallbackYear);
  if (activityDate) return activityDate;
  const edited = parseDate(item?.editedAt, fallbackYear);
  if (edited) return edited;
  const noteId = item?.postId || String(item?.id || "").match(/[0-9a-f]{24}/iu)?.[0] || "";
  if (/^[0-9a-f]{24}$/iu.test(noteId)) return Number.parseInt(noteId.slice(0, 8), 16) * 1_000;
  return 0;
}

export function sortReviewItemsNewestFirst(items) {
  return [...items]
    .map((item, order) => ({ item, order, published: reviewPublishedTimestamp(item) }))
    .sort((left, right) => right.published - left.published || left.order - right.order)
    .map(({ item }) => item);
}
