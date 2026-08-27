import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const queuePath = path.join(root, "data", "xhs-capture-queue.json");
const statePath = path.join(root, "data", "xhs-events-state.json");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const cliConfig = path.join(appData, "xhs-cli");
const python = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "python");
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

export function diffEvents(events, state, previousLatestEventId = "") {
  const known = new Set(state?.knownEventIds || []);
  const normalized = events.filter((event) => event?.sourceUrl).map((event) => ({ ...event, id: eventId(event) }));
  if (state?.initializedAt) return { current: normalized, newEvents: normalized.filter((event) => !known.has(event.id)) };
  const previousIndex = previousLatestEventId ? normalized.findIndex((event) => event.id === previousLatestEventId) : -1;
  return { current: normalized, newEvents: previousIndex >= 0 ? normalized.slice(0, previousIndex) : [] };
}

function runBrowser() {
  const output = execFileSync(python, [browserScript], {
    cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XHS_CLI_CONFIG_DIR: cliConfig, CAIGUANG_CHROME_FALLBACK: process.env.CAIGUANG_CHROME_FALLBACK ?? "1", NO_COLOR: "1" },
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
  if (options.firstLatest && difference.current.length) difference.newEvents = difference.current.slice(0, 1);
  const currentIds = difference.current.map((event) => event.id);
  const baselineOnly = !state.initializedAt && !previousLatestEventId;
  const tasks = difference.newEvents.map((event) => ({
    id: `h5-${event.id}`, type: "h5_event", status: "needs_h5_capture", accountKey: "creator-events",
    title: event.title, slug: slug(event), sourceUrl: event.sourceUrl, coverUrl: event.coverUrl || "",
    captureDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
    displayDate: event.displayDate || "",
  }));
  if (options.write) {
    const check = { accountKey: "creator-events", checkedAt, status: "verified", latestPostId: currentIds[0] || state.latestEventId || "" };
    queue.checkedAccounts = [...queue.checkedAccounts.filter((item) => item.accountKey !== "creator-events"), check];
    const existing = new Set(queue.tasks.map((task) => task.id));
    queue.tasks.push(...tasks.filter((task) => !existing.has(task.id)));
    await atomicJson(queuePath, queue);
    await atomicJson(statePath, {
      schemaVersion: 1,
      initializedAt: state.initializedAt || checkedAt,
      lastCheckedAt: checkedAt,
      latestEventId: currentIds[0] || state.latestEventId || "",
      knownEventIds: [...new Set([...(state.knownEventIds || []), ...currentIds])],
    });
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
