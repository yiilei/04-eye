/** Browser-safe Eagle verification helpers shared by the UI and behavior tests. */

export function eagleItemValidity(data, eagleId, expected) {
  if (!data || typeof data !== "object") return { valid: false, reason: "missing" };
  if (data.isDeleted === true) return { valid: false, reason: "deleted" };
  if (data.id && data.id !== eagleId) return { valid: false, reason: "id_mismatch" };
  if (typeof data.size === "number" && data.size <= 0) return { valid: false, reason: "empty" };
  if (expected && (data.width !== expected.width || data.height !== expected.height)) {
    return { valid: false, reason: "dimensions" };
  }
  return { valid: true, reason: "ok" };
}

/** @param {{previousState?: string, directValidity?: {valid?: boolean}, reconciliation?: string}} options */
export function nextEagleImportAction({ previousState, directValidity, reconciliation = "not_checked" }) {
  if (directValidity?.valid) return "reuse";
  if (reconciliation === "found") return "reuse";
  if (reconciliation === "unavailable" && ["pending", "uncertain", "completed"].includes(previousState)) return "wait";
  return "import";
}

export async function findTaggedEagleItem(fetchImpl, eagleBase, token, expected, verify) {
  const limit = 200;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(page * limit), orderBy: "CREATEDATE", tags: token });
    const response = await fetchImpl(`${eagleBase}/item/list?${query}`, {
      cache: "no-store", signal: AbortSignal.timeout(8_000),
    });
    const result = await response.json();
    if (result.status !== "success") throw new Error(result.message || "Eagle 无法核对已导入文件");
    const candidates = Array.isArray(result.data) ? result.data : result.data?.items || [];
    for (const candidate of candidates) {
      if (candidate.tags?.includes(token) && candidate.id && await verify(candidate.id, expected)) return candidate.id;
    }
    if (candidates.length < limit) return "";
  }
  throw new Error("Eagle 核对分页尚未完成，导入结果待确认");
}
