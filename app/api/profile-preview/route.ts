function decodeJsonString(value: string) {
  try { return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string; }
  catch { return value.replace(/\\u002F/g, "/").replace(/\\\//g, "/"); }
}

function firstMatch(html: string, pattern: RegExp) {
  const value = html.match(pattern)?.[1];
  return value ? decodeJsonString(value) : "";
}

export async function POST(request: Request) {
  const payload = await request.json() as { profileUrl?: string };
  const profileUrl = String(payload.profileUrl || "");
  if (!/^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[a-zA-Z0-9_-]+$/.test(profileUrl)) {
    return Response.json({ ok: false, error: "invalid profile url" }, { status: 400 });
  }
  try {
    const response = await fetch(profileUrl, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139 Safari/537.36" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const displayName = firstMatch(html, /"nickname":"((?:\\.|[^"\\])+)"/);
    const xiaohongshuId = firstMatch(html, /"redId":"((?:\\.|[^"\\])+)"/);
    const avatarUrl = firstMatch(html, /"avatar":"((?:\\.|[^"\\])+)"/);
    if (!displayName || !avatarUrl) throw new Error("主页资料不可见");
    return Response.json({ ok: true, displayName, xiaohongshuId: xiaohongshuId || "待晚间核验", avatarUrl });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "读取失败" }, { status: 502 });
  }
}
