import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import worker from "../dist/server/index.js";

const mime = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".ico", "image/x-icon"],
  [".mp4", "video/mp4"], [".woff2", "font/woff2"],
]);

export async function startDesktopServer(appRoot, userDataRoot) {
  const clientRoot = path.join(appRoot, "dist", "client");
  const cssRoot = path.join(clientRoot, "_next", "static", "css");
  const compiledCss = (await readdir(cssRoot)).find((name) => name.endsWith(".css"));
  const dataRoot = path.resolve(userDataRoot);
  const reviewRoot = path.join(dataRoot, "review");
  const trashRoot = path.join(dataRoot, "trash");
  const registryPath = path.join(dataRoot, "data", "generated-review-items.json");
  const decisionsPath = path.join(dataRoot, "data", "review-decisions.json");
  const trashIndexPath = path.join(dataRoot, "data", "review-trash.json");
  const preferencesPath = path.join(dataRoot, "data", "user-preferences.json");
  await mkdir(path.dirname(registryPath), { recursive: true });
  await mkdir(reviewRoot, { recursive: true });
  await mkdir(trashRoot, { recursive: true });
  try { await stat(registryPath); } catch { await writeFile(registryPath, "[]\n"); }

  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
  const readJson = async (file, fallback) => {
    try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
  };
  const atomicJson = async (file, value) => {
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
  };
  const itemFolder = (item) => {
    const localFile = item?.galleryLocalPaths?.[0] || item?.localPath || item?.videoLocalPath;
    if (!localFile) return undefined;
    const folder = path.dirname(path.resolve(localFile));
    return folder.startsWith(`${reviewRoot}${path.sep}`) ? folder : undefined;
  };
  const serveFile = async (filename, request) => {
    try {
      const info = await stat(filename);
      if (!info.isFile()) return new Response("Not found", { status: 404 });
      const contentType = mime.get(path.extname(filename).toLowerCase()) || "application/octet-stream";
      const range = request.headers.get("range");
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
          const bytes = await readFile(filename);
          return new Response(bytes.subarray(start, end + 1), { status: 206, headers: {
            "Content-Type": contentType, "Accept-Ranges": "bytes",
            "Content-Range": `bytes ${start}-${end}/${info.size}`, "Content-Length": String(end - start + 1),
          } });
        }
      }
      return new Response(await readFile(filename), { headers: { "Content-Type": contentType, "Content-Length": String(info.size) } });
    } catch { return new Response("Not found", { status: 404 }); }
  };
  const assets = {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname === "/app/globals.css" && compiledCss
        ? path.join("_next", "static", "css", compiledCss)
        : pathname.replace(/^\/+/, "");
      const filename = path.resolve(clientRoot, relative);
      if (!filename.startsWith(`${path.resolve(clientRoot)}${path.sep}`)) return new Response("Forbidden", { status: 403 });
      try {
        return await serveFile(filename, request);
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  };

  const server = createServer(async (incoming, outgoing) => {
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const body = incoming.method === "GET" || incoming.method === "HEAD" ? undefined : Readable.toWeb(incoming);
      const request = new Request(new URL(incoming.url || "/", base), {
        method: incoming.method,
        headers: incoming.headers,
        body,
        ...(body ? { duplex: "half" } : {}),
      });
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/desktop/review-items" && request.method === "GET") {
        const items = await readJson(registryPath, []);
        const decisions = await readJson(decisionsPath, {});
        const response = json({ items, decisions, updatedAt: new Date().toISOString() });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/preferences" && request.method === "GET") {
        const response = json(await readJson(preferencesPath, {}));
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/preferences" && request.method === "POST") {
        const payload = await request.json();
        const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (!validTime(payload?.captureTime) || !validTime(payload?.pushTime)
          || !Array.isArray(payload?.pinnedAccountIds) || !Array.isArray(payload?.manualPinAccounts)) {
          const response = json({ ok: false, error: "invalid preferences" }, 400);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        await atomicJson(preferencesPath, {
          schemaVersion: 1,
          captureTime: payload.captureTime,
          pushTime: payload.pushTime,
          pinnedAccountIds: payload.pinnedAccountIds.map(String),
          manualPinAccounts: payload.manualPinAccounts,
          updatedAt: new Date().toISOString(),
        });
        const response = json({ ok: true });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/review-decision" && request.method === "POST") {
        const payload = await request.json();
        if (!payload?.id || !["kept", "rejected", "pending"].includes(payload.decision)) {
          const response = json({ ok: false, error: "invalid decision" }, 400);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        const decisions = await readJson(decisionsPath, {});
        const registry = await readJson(registryPath, []);
        const trashIndex = await readJson(trashIndexPath, {});
        if (payload.decision === "rejected") {
          const itemIndex = registry.findIndex((item) => item.id === payload.id);
          const item = registry[itemIndex];
          if (item && !trashIndex[payload.id]) {
            const originalFolder = itemFolder(item);
            if (!originalFolder) throw new Error("素材目录不在应用资料库中，已阻止删除");
            const safeId = String(payload.id).replace(/[^a-zA-Z0-9_-]+/g, "-");
            const trashFolder = path.join(trashRoot, `${Date.now()}-${safeId}`);
            await rename(originalFolder, trashFolder);
            registry.splice(itemIndex, 1);
            trashIndex[payload.id] = { item, itemIndex, originalFolder, trashFolder, deletedAt: new Date().toISOString() };
            await atomicJson(registryPath, registry);
            await atomicJson(trashIndexPath, trashIndex);
          }
          decisions[payload.id] = { decision: "rejected", updatedAt: new Date().toISOString(), recoverable: true };
        } else if (payload.decision === "pending") {
          const entry = trashIndex[payload.id];
          if (entry) {
            await mkdir(path.dirname(entry.originalFolder), { recursive: true });
            await rename(entry.trashFolder, entry.originalFolder);
            const insertAt = Math.max(0, Math.min(Number(entry.itemIndex) || 0, registry.length));
            if (!registry.some((item) => item.id === payload.id)) registry.splice(insertAt, 0, entry.item);
            delete trashIndex[payload.id];
            await atomicJson(registryPath, registry);
            await atomicJson(trashIndexPath, trashIndex);
          }
          delete decisions[payload.id];
        } else {
          decisions[payload.id] = { decision: payload.decision, updatedAt: new Date().toISOString() };
        }
        await atomicJson(decisionsPath, decisions);
        const response = json({ ok: true, recoverable: payload.decision === "rejected" });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname.startsWith("/media/") && request.method === "GET") {
        const relative = decodeURIComponent(pathname.slice("/media/".length));
        const filename = path.resolve(reviewRoot, relative);
        const allowed = filename === reviewRoot || filename.startsWith(`${reviewRoot}${path.sep}`);
        const response = allowed ? await serveFile(filename, request) : new Response("Forbidden", { status: 403 });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        if (!response.body) return outgoing.end();
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      const isStaticAsset = pathname === "/app/globals.css"
        || pathname.startsWith("/_next/")
        || /\.(?:svg|png|jpe?g|webp|ico|mp4|woff2)$/i.test(pathname);
      const response = isStaticAsset
        ? await assets.fetch(request)
        : await worker.fetch(request, { ASSETS: assets }, { waitUntil() {}, passThroughOnException() {} });
      outgoing.statusCode = response.status;
      response.headers.forEach((value, key) => outgoing.setHeader(key, value));
      if (!response.body) return outgoing.end();
      Readable.fromWeb(response.body).pipe(outgoing);
    } catch (error) {
      outgoing.statusCode = 500;
      outgoing.end(error instanceof Error ? error.message : "Desktop server failed");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { url: `http://127.0.0.1:${server.address().port}/?desktop=1`, close: () => server.close() };
}
