const eagleRoutes = new Set([
  "GET /application/info",
  "GET /folder/list",
  "POST /folder/create",
  "POST /item/addFromPath",
  "GET /item/info",
]);

export async function requestEagle(request = {}, fetchImpl = fetch) {
  const method = String(request.method || "GET").toUpperCase();
  const route = String(request.path || "");
  const pathname = route.split("?", 1)[0];
  if (!eagleRoutes.has(`${method} ${pathname}`) || !route.startsWith("/") || route.includes("..")) {
    return { ok: false, status: 400, error: "不允许的 Eagle API 请求" };
  }
  const body = request.body === undefined ? undefined : JSON.stringify(request.body);
  if (body && Buffer.byteLength(body) > 256 * 1024) {
    return { ok: false, status: 413, error: "Eagle 请求内容过大" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl(`http://127.0.0.1:41595/api${route}`, {
      method,
      body,
      headers: body ? { "Content-Type": "text/plain;charset=UTF-8" } : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = { status: "error", message: text || "Eagle 返回了无法识别的内容" }; }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: error?.name === "AbortError" ? "Eagle 连接超时" : "无法连接 Eagle" };
  } finally {
    clearTimeout(timer);
  }
}
