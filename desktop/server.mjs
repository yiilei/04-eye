import { createServer } from "node:http";
import { Readable } from "node:stream";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import worker from "../dist/server/index.js";

const mime = new Map([
  [".css", "text/css; charset=utf-8"], [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"], [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".ico", "image/x-icon"],
  [".mp4", "video/mp4"], [".woff2", "font/woff2"],
]);

export async function startDesktopServer(appRoot) {
  const clientRoot = path.join(appRoot, "dist", "client");
  const cssRoot = path.join(clientRoot, "_next", "static", "css");
  const compiledCss = (await readdir(cssRoot)).find((name) => name.endsWith(".css"));
  const assets = {
    async fetch(request) {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const relative = pathname === "/app/globals.css" && compiledCss
        ? path.join("_next", "static", "css", compiledCss)
        : pathname.replace(/^\/+/, "");
      const filename = path.resolve(clientRoot, relative);
      if (!filename.startsWith(`${path.resolve(clientRoot)}${path.sep}`)) return new Response("Forbidden", { status: 403 });
      try {
        const info = await stat(filename);
        if (!info.isFile()) return new Response("Not found", { status: 404 });
        const body = await readFile(filename);
        return new Response(body, { headers: { "Content-Type": mime.get(path.extname(filename).toLowerCase()) || "application/octet-stream" } });
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
