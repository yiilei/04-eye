import accountPinsData from "../../../data/xhs-account-pins.json";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedIds = new Set(requestUrl.searchParams.get("ids")?.split(",").filter(Boolean) ?? []);
  let manualAccounts: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(requestUrl.searchParams.get("manual") || "[]");
    if (Array.isArray(parsed)) manualAccounts = parsed.filter((account) =>
      account && typeof account === "object"
      && typeof account.profileId === "string"
      && typeof account.profileUrl === "string");
  } catch { /* ignore malformed manual data */ }
  const accounts = [
    ...accountPinsData.accounts
    .filter((account) => requestedIds.has(account.profileId))
    .map((account) => ({ ...account, pinned: true })),
    ...manualAccounts
      .filter((account) => requestedIds.has(String(account.profileId)))
      .map((account) => ({ ...account, pinned: true })),
  ];
  const date = new Date().toISOString().slice(0, 10);
  const payload = {
    schemaVersion: 1,
    project: "采光",
    platform: "小红书",
    exportedAt: new Date().toISOString(),
    accountCount: accounts.length,
    accounts,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="04-eye-xhs-pins-${date}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
