import { createServer } from "node:http";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import worker from "../dist/server/index.js";
import { seedStarterData } from "./starter-data.mjs";
import { cleanupReviewedMedia } from "../scripts/review-cache-cleanup.mjs";

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
  const pendingPinsPath = path.join(dataRoot, "data", "xhs-pending-pins.json");
  const schedulerStatePath = path.join(dataRoot, "data", "scheduler-state.json");
  const captureProgressPath = path.join(dataRoot, "data", "capture-progress.json");
  const installedSourceRoot = path.join(dataRoot, "source");
  const installedScheduler = path.join(installedSourceRoot, "scripts", "caiguang-scheduler.mjs");
  let captureProcess;
  let captureStartedAt = null;
  let captureExitCode = null;
  let camoufoxFetchProcess;
  let camoufoxFetchExitCode = null;
  await mkdir(path.dirname(registryPath), { recursive: true });
  await mkdir(reviewRoot, { recursive: true });
  await mkdir(trashRoot, { recursive: true });
  // Review media is a bridge, not a permanent library. A restart closes the
  // previous undo window and purges already rejected/imported local copies.
  await cleanupReviewedMedia(dataRoot);
  try { await seedStarterData(appRoot, dataRoot, registryPath, reviewRoot); }
  catch { await writeFile(registryPath, "[]\n"); }

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
        const stored = await readJson(preferencesPath, {});
        // New installs default to automatic capture ON so users don't forget to enable it
        if (stored.automaticCaptureEnabled === undefined) stored.automaticCaptureEnabled = true;
if (stored.creatorH5CaptureEnabled === undefined) stored.creatorH5CaptureEnabled = true;
        const response = json(stored);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
     if (pathname === "/api/desktop/first-run" && request.method === "GET") {
       const preferences = await readJson(preferencesPath, {});
       const response = json({
         onboardingComplete: preferences.onboardingComplete === true,
         reviewTourComplete: preferences.reviewTourComplete === true,
         statsNoticeAcknowledged: preferences.statsNoticeAcknowledged === true,
       });
       outgoing.statusCode = response.status;
       response.headers.forEach((value, key) => outgoing.setHeader(key, value));
       return Readable.fromWeb(response.body).pipe(outgoing);
     }
      if (pathname === "/api/desktop/camoufox-status" && request.method === "GET") {
        const venvPython = path.join(installedSourceRoot, "vendor", "xhs-cli", ".venv", "bin", "python");
        let installed = false;
        let version = null;
        try {
          const { execFileSync } = await import("node:child_process");
          const output = execFileSync(venvPython, ["-m", "camoufox", "list", "--path"], { encoding: "utf8", timeout: 8000, env: process.env });
          installed = /\(active\)/.test(output);
          const match = output.match(/v[\d.]+[\w.-]*/);
          if (match) version = match[0];
        } catch { /* venv not ready yet */ }
        const response = json({ installed, version, ready: installed });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/camoufox-fetch" && request.method === "POST") {
        const venvPython = path.join(installedSourceRoot, "vendor", "xhs-cli", ".venv", "bin", "python");
        try {
          await access(venvPython);
        } catch {
          const response = json({ ok: false, error: "Python 环境未就绪，请等待安装完成" }, 503);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        if (camoufoxFetchProcess) {
          const response = json({ ok: true, running: true }, 202);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        const logPath = path.join(dataRoot, "logs", "camoufox-fetch.log");
        await mkdir(path.dirname(logPath), { recursive: true });
        const { spawn } = await import("node:child_process");
        const logFd = await (await import("node:fs/promises")).open(logPath, "w");
        const child = spawn(venvPython, ["-m", "camoufox", "fetch"], {
          cwd: installedSourceRoot, env: process.env,
          stdio: ["ignore", logFd.createWriteStream(), logFd.createWriteStream()],
        });
        camoufoxFetchProcess = child;
        child.once("exit", (code) => {
          camoufoxFetchProcess = undefined;
          camoufoxFetchExitCode = code ?? -1;
        });
        child.once("error", () => { camoufoxFetchProcess = undefined; camoufoxFetchExitCode = -1; });
        const response = json({ ok: true, running: true }, 202);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/camoufox-fetch" && request.method === "GET") {
        const logPath = path.join(dataRoot, "logs", "camoufox-fetch.log");
        let log = "";
        try { log = await readFile(logPath, "utf8"); } catch { /* log not created yet */ }
        let stage = "准备下载";
        let percent = 0;
        const downloading = log.match(/Downloading[^\d]*(\d+(?:\.\d+)?)%/g);
        const extracting = log.match(/Extracting[^\d]*(\d+(?:\.\d+)?)%/g);
        if (extracting?.length) {
          stage = "正在解压 Camoufox";
          percent = Number(extracting.at(-1)?.match(/(\d+(?:\.\d+)?)%/)?.[1] || 0);
        } else if (downloading?.length) {
          stage = "正在下载 Camoufox";
          percent = Number(downloading.at(-1)?.match(/(\d+(?:\.\d+)?)%/)?.[1] || 0);
        } else if (/Camoufox v[\d.]+[\w.-]* installed/.test(log)) {
          stage = "正在完成配置";
          percent = 100;
        }
        const response = json({
          running: Boolean(camoufoxFetchProcess),
          exitCode: camoufoxFetchExitCode,
          stage,
          percent,
        });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
     if (pathname === "/api/desktop/capture-now" && request.method === "GET") {
       const state = await readJson(schedulerStatePath, {});
       const progress = await readJson(captureProgressPath, {});
       const response = json({
          ok: true,
          running: Boolean(captureProcess),
          startedAt: captureStartedAt,
          exitCode: captureExitCode,
          state,
          progress,
        });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/capture-now" && request.method === "POST") {
        const explicitFirstCapture = new URL(request.url).searchParams.get("initial") === "1";
        // Auto-detect first capture: if no prior capture ever succeeded, treat as first run
        const schedulerState = await readJson(schedulerStatePath, {});
        const firstCapture = explicitFirstCapture
          || !schedulerState.lastCaptureDate
          || schedulerState.lastCaptureStatus !== "completed";
        if (captureProcess) {
          const response = json({ ok: true, running: true, startedAt: captureStartedAt }, 202);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        try {
          await access(installedScheduler);
        } catch {
          const response = json({ ok: false, error: "采光本地采集组件不完整，请重新安装最新版。" }, 503);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        captureStartedAt = new Date().toISOString();
        captureExitCode = null;
        const child = spawn(process.execPath, [installedScheduler, "run"], {
          cwd: installedSourceRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SHARP_EYE_HOME: dataRoot, CAIGUANG_FIRST_CAPTURE: firstCapture ? "1" : "0" },
          stdio: "ignore",
        });
        captureProcess = child;
        child.once("error", () => {
          captureExitCode = -1;
          captureProcess = undefined;
        });
        child.once("exit", (code) => {
          captureExitCode = code ?? -1;
          captureProcess = undefined;
        });
        const response = json({ ok: true, running: true, startedAt: captureStartedAt }, 202);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/pending-pins" && request.method === "GET") {
        const response = json(await readJson(pendingPinsPath, { schemaVersion: 1, updatedAt: null, accounts: [] }));
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/pending-pins" && request.method === "POST") {
        const payload = await request.json();
        const accounts = Array.isArray(payload?.accounts) ? payload.accounts.filter((account) =>
          account && typeof account.profileId === "string"
          && typeof account.profileUrl === "string"
          && account.status === "pending_verification") : undefined;
        if (!accounts) {
          const response = json({ ok: false, error: "invalid accounts" }, 400);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        await atomicJson(pendingPinsPath, { schemaVersion: 1, updatedAt: new Date().toISOString(), accounts });
        const response = json({ ok: true, count: accounts.length });
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/profile-preview" && request.method === "POST") {
        const payload = await request.json();
        const profileUrl = String(payload?.profileUrl || "");
        let result;
        let status = 200;
        if (!/^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[a-zA-Z0-9_-]+$/.test(profileUrl)) {
          result = { ok: false, error: "invalid profile url" };
          status = 400;
        } else {
          try {
            const profileResponse = await fetch(profileUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139 Safari/537.36" },
            });
            if (!profileResponse.ok) throw new Error(`HTTP ${profileResponse.status}`);
            const html = await profileResponse.text();
            const decode = (value) => { try { return JSON.parse(`"${value.replace(/"/g, '\\"')}"`); } catch { return value.replace(/\\u002F/g, "/").replace(/\\\//g, "/"); } };
            const match = (pattern) => { const value = html.match(pattern)?.[1]; return value ? decode(value) : ""; };
            const displayName = match(/"nickname":"((?:\\.|[^"\\])+)"/);
            const xiaohongshuId = match(/"redId":"((?:\\.|[^"\\])+)"/);
            const avatarUrl = match(/"avatar":"((?:\\.|[^"\\])+)"/);
            if (!displayName || !avatarUrl) throw new Error("主页资料不可见");
            result = { ok: true, displayName, xiaohongshuId: xiaohongshuId || "待晚间核验", avatarUrl };
          } catch (error) {
            result = { ok: false, error: error instanceof Error ? error.message : "读取失败" };
            status = 502;
          }
        }
        const response = json(result, status);
        outgoing.statusCode = response.status;
        response.headers.forEach((value, key) => outgoing.setHeader(key, value));
        return Readable.fromWeb(response.body).pipe(outgoing);
      }
      if (pathname === "/api/desktop/preferences" && request.method === "POST") {
        const payload = await request.json();
        const validTime = (value) => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
        if (typeof payload?.automaticCaptureEnabled !== "boolean"
          || typeof payload?.creatorH5CaptureEnabled !== "boolean"
          || !validTime(payload?.captureTime) || !validTime(payload?.pushTime)
          || !Array.isArray(payload?.pinnedAccountIds) || !Array.isArray(payload?.manualPinAccounts)) {
          const response = json({ ok: false, error: "invalid preferences" }, 400);
          outgoing.statusCode = response.status;
          response.headers.forEach((value, key) => outgoing.setHeader(key, value));
          return Readable.fromWeb(response.body).pipe(outgoing);
        }
        const existing = await readJson(preferencesPath, {});
        await atomicJson(preferencesPath, {
          ...existing,
          schemaVersion: 1,
          automaticCaptureEnabled: payload.automaticCaptureEnabled,
          creatorH5CaptureEnabled: payload.creatorH5CaptureEnabled,
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
      if (pathname === "/api/desktop/first-run" && request.method === "POST") {
        const payload = await request.json();
        const existing = await readJson(preferencesPath, {});
        await atomicJson(preferencesPath, {
          ...existing,
          ...(typeof payload?.onboardingComplete === "boolean" ? { onboardingComplete: payload.onboardingComplete } : {}),
          ...(typeof payload?.reviewTourComplete === "boolean" ? { reviewTourComplete: payload.reviewTourComplete } : {}),
          ...(typeof payload?.statsNoticeAcknowledged === "boolean" ? { statsNoticeAcknowledged: payload.statsNoticeAcknowledged } : {}),
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
