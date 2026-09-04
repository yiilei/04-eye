import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const pinsPath = path.join(appData, "data", "xhs-account-pins.json");
const queuePath = path.join(appData, "data", "xhs-capture-queue.json");
const xhsExecutable = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "xhs");
const cliConfig = path.join(appData, "xhs-cli");
const preferencesPath = path.join(appData, "data", "user-preferences.json");

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const atomicJson = async (file, value) => {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

function valueAt(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

export function profileIdentity(payload) {
  const page = firstObject(payload?.userPageData, payload?.user_page_data);
  const basic = firstObject(page?.basicInfo, page?.basic_info, payload?.basicInfo, payload?.basic_info, payload?.userInfo, payload?.user_info, payload);
  return {
    displayName: valueAt(basic, ["nickname", "nickName", "nick_name", "name"]),
    xiaohongshuId: valueAt(basic, ["redId", "red_id", "redsId", "xiaohongshuId", "xhsId"]),
    profileId: valueAt(basic, ["userId", "user_id", "id"]),
  };
}

function noteEntries(value, depth = 0) {
  if (depth > 6 || value == null) return [];
  if (Array.isArray(value)) return value.flatMap((entry) => noteEntries(entry, depth + 1));
  if (typeof value !== "object") return [];
  if (value.id || value.noteId || value.note_id || value.noteCard || value.note_card) return [value];
  for (const key of ["notes", "value", "_value", "_rawValue", "data", "list"]) {
    const result = noteEntries(value[key], depth + 1);
    if (result.length) return result;
  }
  return [];
}

export function normalizePosts(payload, account) {
  const rawNotes = noteEntries(payload?.notes ?? payload?.userPageData?.notes ?? payload);
  return rawNotes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const card = firstObject(item.note_card, item.noteCard, item.card, item);
    const id = valueAt(item, ["id", "noteId", "note_id"]) || valueAt(card, ["id", "noteId", "note_id"]);
    if (!id) return [];
    const token = valueAt(item, ["xsec_token", "xsecToken"]) || valueAt(card, ["xsec_token", "xsecToken"]);
    const title = valueAt(card, ["display_title", "displayTitle", "title"]) || `小红书帖子 ${id.slice(0, 8)}`;
    const pinned = Boolean(item._caiguangPinned ?? item.isPinned ?? item.is_pinned ?? item.isTop ?? item.is_top ??
      card.isPinned ?? card.is_pinned ?? card.isTop ?? card.is_top);
    const query = new URLSearchParams({ xsec_source: "pc_user" });
    if (token) query.set("xsec_token", token);
    return [{ id, title, token, pinned, sourceUrl: `https://www.xiaohongshu.com/explore/${id}?${query.toString()}`, accountKey: account.searchKey }];
  });
}

export function profileIdentityFromPosts(payload) {
  for (const item of noteEntries(payload)) {
    const card = firstObject(item.note_card, item.noteCard, item.card, item);
    const user = firstObject(card.user, item.user);
    const identity = {
      displayName: valueAt(user, ["nickname", "nickName", "nick_name", "name"]),
      xiaohongshuId: valueAt(user, ["redId", "red_id", "xiaohongshuId", "xhsId"]),
      profileId: valueAt(user, ["userId", "user_id", "id"]),
    };
    if (identity.displayName || identity.profileId) return identity;
  }
  return { displayName: "", xiaohongshuId: "", profileId: "" };
}

export function postIdTimestamp(postId) {
  if (!/^[0-9a-f]{24}$/i.test(postId)) return 0;
  const seconds = Number.parseInt(postId.slice(0, 8), 16);
  return Number.isFinite(seconds) ? seconds * 1000 : 0;
}

export function diffPosts(posts, lastSeenPostId) {
  if (!posts.length) return { status: "empty", latestPostId: lastSeenPostId, newPosts: [] };
  const baselineTimestamp = postIdTimestamp(lastSeenPostId);
  const canChronologicallySort = baselineTimestamp > 0 && posts.every((post) => postIdTimestamp(post.id) > 0);
  const orderedPosts = canChronologicallySort
    ? [...posts].sort((left, right) => postIdTimestamp(right.id) - postIdTimestamp(left.id))
    : posts.filter((post) => !post.pinned || post.id === lastSeenPostId);
  if (!orderedPosts.length) return { status: "empty", latestPostId: lastSeenPostId, newPosts: [] };
  const latestPostId = orderedPosts[0].id;
  if (latestPostId === lastSeenPostId) return { status: "verified", latestPostId, newPosts: [] };
  const baselineIndex = orderedPosts.findIndex((post) => post.id === lastSeenPostId);
  if (baselineIndex < 0) return { status: "baseline_missing", latestPostId, newPosts: [] };
  return { status: "verified", latestPostId, newPosts: orderedPosts.slice(0, baselineIndex).reverse() };
}

export function latestPostOnly(posts) {
  const visible = posts.filter((post) => !post.pinned);
  const candidates = visible.length ? visible : posts;
  const latest = [...candidates].sort((left, right) => postIdTimestamp(right.id) - postIdTimestamp(left.id))[0];
  return latest ? { status: "verified", latestPostId: latest.id, newPosts: [latest] } : { status: "empty", latestPostId: "", newPosts: [] };
}

export function mergeDiscoveredTasks(existingTasks, discoveredTasks) {
  const discoveredById = new Map(discoveredTasks.map((task) => [task.id, task]));
  const merged = existingTasks.map((task) => {
    const fresh = discoveredById.get(task.id);
    if (!fresh) return task;
    discoveredById.delete(task.id);
    // A newly discovered URL carries a fresh xsec_token. Recover tasks that
    // were previously stranded by an empty downloader result, while keeping
    // completed work immutable.
    if (task.status === "completed") return task;
    const recoverable = ["needs_browser_capture", "retry_pending"].includes(task.status);
    const next = { ...task, ...fresh, status: recoverable ? "pending" : task.status };
    if (recoverable) {
      for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "failedAt", "failureType", "error", "diagnosticsPath"]) delete next[key];
    }
    return next;
  });
  return [...merged, ...discoveredById.values()];
}

export function captureCandidates(posts, newPosts, existingTasks, accountKey) {
  const recoverableIds = new Set(existingTasks
    .filter((task) => task.accountKey === accountKey && ["needs_browser_capture", "retry_pending"].includes(task.status))
    .map((task) => task.id));
  const candidates = [...newPosts, ...posts.filter((post) => recoverableIds.has(`note-${post.id}`))];
  return [...new Map(candidates.map((post) => [post.id, post])).values()];
}

export function selectAccounts(accounts, accountKeys = [], pinnedAccountIds) {
  const explicit = new Set(accountKeys || []);
  const pinned = Array.isArray(pinnedAccountIds) ? new Set(pinnedAccountIds.map(String)) : null;
  return accounts.filter((account) => {
    if (account.status !== "verified") return false;
    if (explicit.size) return explicit.has(account.searchKey) || explicit.has(account.xiaohongshuId) || explicit.has(account.profileId);
    return pinned ? pinned.has(String(account.profileId)) : true;
  });
}

export function accountCapturePolicy(accountCount) {
  if (accountCount <= 30) return { tier: "standard", batchSize: 10, accountDelayMs: [5_000, 9_000], batchDelayMs: [60_000, 120_000] };
  if (accountCount <= 60) return { tier: "cautious", batchSize: 10, accountDelayMs: [8_000, 14_000], batchDelayMs: [120_000, 180_000] };
  return { tier: "conservative", batchSize: 8, accountDelayMs: [10_000, 18_000], batchDelayMs: [180_000, 300_000] };
}

export function isSafetyStopError(message) {
  return /(429|验证码|访问频繁|操作频繁|风控|登录失效|login.required|unauthorized|forbidden|账号异常)/iu.test(String(message || ""));
}

const randomDelay = ([minimum, maximum]) => minimum + Math.floor(Math.random() * (maximum - minimum + 1));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function slugFor(account, post) {
  const safeAccount = account.xiaohongshuId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `xhs-${safeAccount}-${post.id}`;
}

function parseArguments(argv) {
  const result = { accountKeys: [], write: false, fixture: "", maxAccounts: Infinity, firstLatest: process.env.CAIGUANG_FIRST_CAPTURE === "1" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--write") result.write = true;
    else if (value === "--account") result.accountKeys.push(argv[++index]);
    else if (value === "--fixture") result.fixture = argv[++index];
    else if (value === "--max-accounts") result.maxAccounts = Number(argv[++index]);
    else if (value === "--first-latest") result.firstLatest = true;
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

function runXhs(args) {
  return execFileSync(xhsExecutable, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XHS_CLI_CONFIG_DIR: cliConfig, XHS_CLI_DISABLE_BROWSER_COOKIE: process.env.XHS_CLI_DISABLE_BROWSER_COOKIE ?? "0", CAIGUANG_CHROME_FALLBACK: process.env.CAIGUANG_CHROME_FALLBACK ?? "1", NO_COLOR: "1" },
  }).trim();
}

function sessionAvailable() {
  try {
    runXhs(["status"]);
    return true;
  } catch {
    return false;
  }
}

function assertIdentity(account, identity) {
  if (identity.profileId && identity.profileId !== account.profileId) return `内部 ID 不一致：${identity.profileId}`;
  if (identity.xiaohongshuId && identity.xiaohongshuId !== account.xiaohongshuId) return `小红书号不一致：${identity.xiaohongshuId}`;
  if (identity.displayName && identity.displayName !== account.displayName && identity.displayName !== account.previousDisplayName) return `账号名称不一致：${identity.displayName}`;
  if (!identity.displayName && !identity.xiaohongshuId && !identity.profileId) return "主页未返回可核验身份";
  return "";
}

export async function discover(options = {}) {
  const pins = await readJson(pinsPath);
  const queue = await readJson(queuePath);
  const preferences = await readJson(preferencesPath).catch(() => null);
  const selected = selectAccounts(pins.accounts, options.accountKeys, preferences?.pinnedAccountIds)
    .slice(0, Math.min(100, options.maxAccounts ?? 100));
  if (!selected.length) {
    if (options.accountKeys?.length) throw new Error("没有匹配的已验证账号埋点");
    return { ok: true, status: options.write ? "written" : "dry_run", checked: 0, added: 0, checks: [], tasks: [] };
  }
  const chromeFallbackEnabled = (process.env.CAIGUANG_CHROME_FALLBACK ?? "1") === "1";
  if (!options.fixture && !chromeFallbackEnabled && !sessionAvailable()) return { ok: false, status: "login_required", checked: 0, added: 0, configDir: cliConfig };

  const fixture = options.fixture ? await readJson(path.resolve(root, options.fixture)) : null;
  const checkedAt = new Date().toISOString();
  const checks = [];
  const pendingTasks = [];
  const ratePolicy = accountCapturePolicy(selected.length);
  const pacingEnabled = !options.fixture && process.env.CAIGUANG_DISABLE_ACCOUNT_PACING !== "1";
  let consecutiveSafetyErrors = 0;
  let safetyStopped = false;
  for (const [accountIndex, account] of selected.entries()) {
    try {
      const fixturePayload = fixture?.[account.searchKey];
      const postsPayload = fixturePayload?.posts ?? fixturePayload?.notes ?? (fixturePayload ? fixturePayload : JSON.parse(runXhs(["user-posts", account.profileId, "--json"])));
      let identity = fixturePayload?.profile ? profileIdentity(fixturePayload.profile) : profileIdentityFromPosts(postsPayload);
      if (!fixturePayload && (!identity.displayName || !identity.profileId)) {
        identity = profileIdentity(JSON.parse(runXhs(["user", account.profileId, "--json"])));
      }
      const identityError = assertIdentity(account, identity);
      if (identityError) {
        checks.push({ accountKey: account.searchKey, checkedAt, status: "pin_invalid", latestPostId: account.lastSeenPostId, error: identityError });
        continue;
      }
      const posts = normalizePosts(postsPayload, account);
      const difference = options.firstLatest ? latestPostOnly(posts) : diffPosts(posts, account.lastSeenPostId);
      checks.push({ accountKey: account.searchKey, checkedAt, status: difference.status, latestPostId: difference.latestPostId,
        ...(difference.status === "baseline_missing" ? { error: "主页首批帖子中未找到上次基线，已停止，避免误抓历史内容" } : {}) });
      for (const post of captureCandidates(posts, difference.newPosts, queue.tasks, account.searchKey)) {
        pendingTasks.push({ id: `note-${post.id}`, type: "note", status: "pending", accountKey: account.searchKey,
          title: post.title, slug: slugFor(account, post), sourceUrl: post.sourceUrl,
          captureDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) });
      }
      consecutiveSafetyErrors = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = message.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "未知发现错误";
      checks.push({ accountKey: account.searchKey, checkedAt, status: "discovery_failed", latestPostId: account.lastSeenPostId,
        error: detail });
      consecutiveSafetyErrors = isSafetyStopError(detail) ? consecutiveSafetyErrors + 1 : 0;
      if (consecutiveSafetyErrors >= 2) {
        safetyStopped = true;
        for (const deferred of selected.slice(accountIndex + 1)) {
          checks.push({ accountKey: deferred.searchKey, checkedAt, status: "deferred_safety_stop", latestPostId: deferred.lastSeenPostId,
            error: "连续出现登录或访问限制，已停止本轮检查以保护账号" });
        }
        break;
      }
    }
    if (pacingEnabled && accountIndex < selected.length - 1) {
      const completed = accountIndex + 1;
      const delay = completed % ratePolicy.batchSize === 0
        ? randomDelay(ratePolicy.batchDelayMs)
        : randomDelay(ratePolicy.accountDelayMs);
      await wait(delay);
    }
  }

  if (options.write) {
    const selectedKeys = new Set(selected.map((account) => account.searchKey));
    queue.checkedAccounts = [...queue.checkedAccounts.filter((check) => !selectedKeys.has(check.accountKey)), ...checks];
    queue.tasks = mergeDiscoveredTasks(queue.tasks, pendingTasks);
    await atomicJson(queuePath, queue);
  }
  return { ok: checks.every((check) => check.status === "verified"), status: options.write ? "written" : "dry_run",
    checked: checks.filter((check) => check.status !== "deferred_safety_stop").length, added: pendingTasks.length,
    ratePolicy, safetyStopped, checks, tasks: pendingTasks };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await mkdir(cliConfig, { recursive: true, mode: 0o700 });
  const result = await discover(options);
  console.log(JSON.stringify(result));
  if (["login_required", "error"].includes(result.status)) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, status: "error", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
