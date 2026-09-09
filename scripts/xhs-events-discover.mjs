import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const queuePath = path.join(appData, "data", "xhs-capture-queue.json");
const statePath = path.join(appData, "data", "xhs-events-state.json");
const cliConfig = path.join(appData, "xhs-cli");
const python = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "python");
const xhsRoot = path.join(root, "vendor", "xhs-cli");
const browserScript = path.join(root, "scripts", "xhs-events-browser.py");

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
};
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};
const eventId = (event) => event.activityId || createHash("sha256").update(event.sourceUrl).digest("hex").slice(0, 16);
const slug = (event) => `xhs-event-${eventId(event)}`;
export const eventFingerprint = (event) => createHash("sha256").update(JSON.stringify({
  id: event.id || eventId(event), sourceUrl: event.sourceUrl || "", detailResolution: event.detailResolution || "",
  detailEvidence: event.detailEvidence || "", title: event.title || "", description: event.description || "",
  displayDate: event.displayDate || "",
})).digest("hex").slice(0, 20);

export function diffEvents(events, state, previousLatestEventId = "") {
  const known = new Set(state?.knownEventIds || []);
  const unique = new Map();
  for (const event of events.filter((item) => item?.sourceUrl)) {
    const normalized = { ...event, id: eventId(event) };
    // Keep the last observation because detail resolution may replace a list
    // route with the verified H5 route while preserving the original order.
    unique.set(normalized.id, normalized);
  }
  const normalized = [...unique.values()];
  if (state?.initializedAt) return { current: normalized, newEvents: normalized.filter((event) => !known.has(event.id)) };
  const previousIndex = previousLatestEventId ? normalized.findIndex((event) => event.id === previousLatestEventId) : -1;
  return { current: normalized, newEvents: previousIndex >= 0 ? normalized.slice(0, previousIndex) : [] };
}

export function firstCaptureEvents(events, limit = 3) {
  return events.slice(0, Math.max(0, limit));
}

export function migrateTaskUrls(tasks, events) {
  const byId = new Map(events.filter((event) => {
    try {
      const url = new URL(event.sourceUrl);
      return event.detailResolution === "resolved" && url.protocol === "https:" && url.hostname === "fe.xiaohongshu.com"
        && url.pathname.replace(/\/$/, "").endsWith(`/vincent/${event.id}`);
    } catch { return false; }
  }).map((event) => [event.id, event]));
  const recoverableStatuses = new Set(["pending", "needs_h5_capture", "fallback_pending", "retry_pending", "failed", "deferred_next_day",
    "content_not_published", "manual_only", "rule_changed", "unavailable"]);
  for (const task of tasks) {
    if (!recoverableStatuses.has(task.status)) continue;
    const eventId = String(task.id || "").replace(/^h5-/, "");
    const event = byId.get(eventId);
    if (!event) continue;
    const fingerprint = eventFingerprint(event);
    const changed = task.sourceUrl !== event.sourceUrl
      || (task.eventFingerprint && task.eventFingerprint !== fingerprint)
      || (task.detailResolution === "unresolved" && event.detailResolution === "resolved");
    if (!changed) {
      task.eventFingerprint ||= fingerprint;
      continue;
    }
    task.sourceUrl = event.sourceUrl;
    task.detailResolution = "resolved";
    task.detailEvidence = event.detailEvidence;
    task.coverUrl = event.coverUrl || task.coverUrl || "";
    task.eventFingerprint = fingerprint;
    task.status = "needs_h5_capture";
    for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "nextEligibleDate", "failedAt", "error",
      "failureType", "failureDays", "lastFailureDate"]) delete task[key];
  }
  return tasks;
}

function runBrowser() {
  const output = execFileSync(python, [browserScript], {
    cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PYTHONPATH: [xhsRoot, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
      XHS_CLI_CONFIG_DIR: cliConfig,
      CAIGUANG_CHROME_FALLBACK: process.env.CAIGUANG_CHROME_FALLBACK ?? "1",
      NO_COLOR: "1",
    },
  }).trim();
  return JSON.parse(output.split("\n").at(-1));
}

export async function discoverEvents(options = {}) {
  const queue = await readJson(queuePath, { schemaVersion: 1, checkedAccounts: [], tasks: [] });
  const state = await readJson(statePath, { schemaVersion: 1, initializedAt: null, knownEventIds: [] });
  const checkedAt = new Date().toISOString();
  let result;
  try {
    result = options.fixture ? await readJson(path.resolve(root, options.fixture), null) : runBrowser();
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n").filter(Boolean).at(-1) : String(error);
    if (options.write) {
      queue.checkedAccounts = [...queue.checkedAccounts.filter((item) => item.accountKey !== "creator-events"),
        { accountKey: "creator-events", checkedAt, status: "discovery_failed", latestPostId: state.latestEventId || "", error: message }];
      await atomicJson(queuePath, queue);
    }
    return { ok: false, status: "discovery_failed", checked: 0, added: 0, error: message };
  }
  if (!result?.ok) return { ok: false, status: result?.status || "discovery_failed", checked: 0, added: 0 };
  if (!Array.isArray(result.events) || result.events.length === 0) {
    return { ok: false, status: "empty", checked: 0, added: 0, error: "创作服务中心没有返回可识别活动，未更新基线", diagnostics: result.diagnostics };
  }

  const previousCreatorCheck = queue.checkedAccounts.find((item) => item.accountKey === "creator-events");
  const previousLatestEventId = state.latestEventId || previousCreatorCheck?.latestPostId || "";
  const difference = diffEvents(result.events || [], state, previousLatestEventId);
  if (options.firstLatest && difference.current.length) difference.newEvents = firstCaptureEvents(difference.current);
  const currentIds = difference.current.map((event) => event.id);
  const baselineOnly = !state.initializedAt && !previousLatestEventId;
  const tasks = difference.newEvents.map((event) => ({
    id: `h5-${event.id}`, type: "h5_event", status: "needs_h5_capture", accountKey: "creator-events",
    title: event.title, slug: slug(event), sourceUrl: event.sourceUrl, coverUrl: event.coverUrl || "",
    captureDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
    displayDate: event.displayDate || "",
    detailResolution: event.detailResolution || "unresolved", detailError: event.detailError || "",
    eventFingerprint: eventFingerprint(event),
  }));
  if (options.write) {
    // Browser discovery can take close to a minute. Re-read immediately before
    // writing so a capture/decision made during that time is never overwritten.
    const liveQueue = await readJson(queuePath, queue);
    const liveState = await readJson(statePath, state);
    const check = { accountKey: "creator-events", checkedAt, status: "verified", latestPostId: currentIds[0] || state.latestEventId || "" };
    liveQueue.checkedAccounts = [...liveQueue.checkedAccounts.filter((item) => item.accountKey !== "creator-events"), check];
    // Activities can change frontend route after publication (for example
    // /ditto/ -> /barleypromotion/). Migrate the existing task by activity ID
    // before adding anything, and clear the old publication-failure retry.
    migrateTaskUrls(liveQueue.tasks, difference.current);
    const existing = new Set(liveQueue.tasks.map((task) => task.id));
    const inserted = tasks.filter((task) => !existing.has(task.id));
    liveQueue.tasks.push(...inserted);
    await atomicJson(queuePath, liveQueue);
    await atomicJson(statePath, {
      schemaVersion: 1,
      initializedAt: liveState.initializedAt || state.initializedAt || checkedAt,
      lastCheckedAt: checkedAt,
      latestEventId: currentIds[0] || liveState.latestEventId || state.latestEventId || "",
      knownEventIds: [...new Set([...(liveState.knownEventIds || []), ...(state.knownEventIds || []), ...currentIds])],
    });
    return { ok: true, status: "written", baselineOnly, checked: difference.current.length,
      added: inserted.length, events: difference.current, tasks: inserted };
  }
  return { ok: true, status: options.write ? "written" : "dry_run", baselineOnly, checked: difference.current.length,
    added: tasks.length, events: difference.current, tasks };
}

function parseArguments(argv) {
  const result = { write: false, fixture: "", firstLatest: process.env.CAIGUANG_FIRST_CAPTURE === "1" };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--") continue;
    if (argv[index] === "--write") result.write = true;
    else if (argv[index] === "--fixture") result.fixture = argv[++index];
    else if (argv[index] === "--first-latest") result.firstLatest = true;
    else throw new Error(`未知参数：${argv[index]}`);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  discoverEvents(parseArguments(process.argv.slice(2))).then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, status: "error", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
