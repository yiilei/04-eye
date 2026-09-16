import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isTransientBrowserFailure } from "./browser-recovery-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const pinsPath = path.join(appData, "data", "xhs-account-pins.json");
const queuePath = path.join(appData, "data", "xhs-capture-queue.json");
const xhsExecutable = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "xhs");
const cliConfig = path.join(appData, "xhs-cli");
const preferencesPath = path.join(appData, "data", "user-preferences.json");
const backlogPath = path.join(appData, "data", "xhs-discovery-backlog.json");
const captureProgressPath = process.env.CAIGUANG_CAPTURE_PROGRESS_PATH || path.join(appData, "data", "capture-progress.json");

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

export function rebaselineAfterResume(posts, lastSeenPostId = "") {
  const latest = latestPostOnly(posts);
  return latest.status === "verified"
    ? { status: "verified", latestPostId: latest.latestPostId, newPosts: [], resumedFromPause: true }
    : { status: latest.status, latestPostId: lastSeenPostId, newPosts: [], resumedFromPause: true };
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
    const recoverable = ["needs_browser_capture", "retry_pending", "user_action_required", "failed"].includes(task.status);
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
    .filter((task) => task.accountKey === accountKey && ["needs_browser_capture", "retry_pending", "user_action_required", "failed"].includes(task.status))
    .map((task) => task.id));
  const candidates = [...newPosts, ...posts.filter((post) => recoverableIds.has(`note-${post.id}`))];
  return [...new Map(candidates.map((post) => [post.id, post])).values()];
}

export function mergeBacklogPosts(previous = [], current = []) {
  const currentIds = new Set(current.map((post) => post.id));
  return [...current, ...previous.filter((post) => !currentIds.has(post.id))];
}

export function nextBacklogScan(previous, baselineId, { manual = false, step = 6, automaticLimit = 24, hardLimit = 48 } = {}) {
  const sameBaseline = previous?.baselineId === baselineId;
  const depth = sameBaseline ? Math.max(0, Number(previous.scanDepth) || 0) : 0;
  if (sameBaseline && previous.state === "manual_required" && !manual) {
    return { scan: false, scanDepth: depth, state: "manual_required" };
  }
  const limit = manual ? hardLimit : automaticLimit;
  const scanDepth = Math.min(limit, Math.max(step, depth + step));
  return { scan: true, scanDepth, state: scanDepth >= limit ? "manual_required" : "pending" };
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

export function discoveryCommandTimeoutMs(value = process.env.CAIGUANG_DISCOVERY_COMMAND_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(5_000, Math.min(120_000, parsed)) : 45_000;
}

export function retryableAccountKeys(checks = []) {
  return new Set(checks.filter((check) => ["discovery_failed", "deferred_transient_timeout"].includes(check?.status))
    .map((check) => String(check.accountKey || "")).filter(Boolean));
}

const randomDelay = ([minimum, maximum]) => minimum + Math.floor(Math.random() * (maximum - minimum + 1));
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function slugFor(account, post) {
  const safeAccount = account.xiaohongshuId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `xhs-${safeAccount}-${post.id}`;
}

function parseArguments(argv) {
  const result = { accountKeys: [], write: false, fixture: "", maxAccounts: Infinity,
    firstLatest: process.env.CAIGUANG_FIRST_CAPTURE === "1", continueBacklog: process.env.CAIGUANG_MANUAL_CONTINUE === "1",
    retryFailedOnly: process.env.CAIGUANG_RETRY_FAILED_ONLY === "1" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") continue;
    if (value === "--write") result.write = true;
    else if (value === "--account") result.accountKeys.push(argv[++index]);
    else if (value === "--fixture") result.fixture = argv[++index];
    else if (value === "--max-accounts") result.maxAccounts = Number(argv[++index]);
    else if (value === "--first-latest") result.firstLatest = true;
    else if (value === "--continue-backlog") result.continueBacklog = true;
    else if (value === "--retry-failed-only") result.retryFailedOnly = true;
    else throw new Error(`未知参数：${value}`);
  }
  return result;
}

function runXhs(args) {
  return execFileSync(xhsExecutable, args, {
    cwd: root,
    encoding: "utf8",
    timeout: discoveryCommandTimeoutMs(),
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
  const resumeRebaselineIds = new Set((preferences?.rebaselineOnResumeProfileIds || []).map(String));
  const backlog = await readJson(backlogPath).catch(() => ({ schemaVersion: 1, accounts: {} }));
  backlog.accounts ||= {};
  let selected = selectAccounts(pins.accounts, options.accountKeys, preferences?.pinnedAccountIds)
    .slice(0, Math.min(100, options.maxAccounts ?? 100));
  if (options.retryFailedOnly) {
    const retryKeys = retryableAccountKeys(queue.checkedAccounts);
    // If an earlier phase failed before account discovery wrote its checkpoint,
    // there is no reliable retry subset; fall back to the normal selected list.
    if (retryKeys.size) selected = selected.filter((account) => retryKeys.has(account.searchKey));
  }
  if (!selected.length) {
    if (options.accountKeys?.length) throw new Error("没有匹配的已验证账号埋点");
    return { ok: true, status: options.write ? "written" : "dry_run", checked: 0, added: 0, checks: [], tasks: [] };
  }
  const chromeFallbackEnabled = (process.env.CAIGUANG_CHROME_FALLBACK ?? "1") === "1";
  if (!options.fixture && !chromeFallbackEnabled && !sessionAvailable()) return { ok: false, status: "login_required", checked: 0, added: 0, configDir: cliConfig };

  const fixture = options.fixture ? await readJson(path.resolve(root, options.fixture)) : null;
  const invokeXhs = options.xhsRunner || runXhs;
  const checkedAt = new Date().toISOString();
  const checks = [];
  const pendingTasks = [];
  const ratePolicy = accountCapturePolicy(selected.length);
  const pacingEnabled = !options.fixture && process.env.CAIGUANG_DISABLE_ACCOUNT_PACING !== "1";
  let consecutiveSafetyErrors = 0;
  let consecutiveTransientErrors = 0;
  let safetyStopped = false;
  let transientStopped = false;
  for (const [accountIndex, account] of selected.entries()) {
    if (options.write) {
      const currentProgress = await readJson(captureProgressPath).catch(() => ({}));
      const accountNumber = accountIndex + 1;
      await atomicJson(captureProgressPath, { ...currentProgress, state: "running", phase: "discover_pinned_accounts",
        label: `检查埋点账号 ${accountNumber}/${selected.length}：${account.displayName || account.searchKey}`,
        percent: Math.min(70, 52 + Math.floor(accountIndex / Math.max(1, selected.length) * 18)),
        accountNumber, accountCount: selected.length, updatedAt: new Date().toISOString() });
    }
    try {
      const fixturePayload = fixture?.[account.searchKey];
      const postsPayload = fixturePayload?.posts ?? fixturePayload?.notes ?? (fixturePayload ? fixturePayload : JSON.parse(invokeXhs(["user-posts", account.profileId, "--json"])));
      let identity = fixturePayload?.profile ? profileIdentity(fixturePayload.profile) : profileIdentityFromPosts(postsPayload);
      if (!fixturePayload && (!identity.displayName || !identity.profileId)) {
        identity = profileIdentity(JSON.parse(invokeXhs(["user", account.profileId, "--json"])));
      }
      const identityError = assertIdentity(account, identity);
      if (identityError) {
        checks.push({ accountKey: account.searchKey, checkedAt, status: "pin_invalid", latestPostId: account.lastSeenPostId, error: identityError });
        continue;
      }
      let posts = normalizePosts(postsPayload, account);
      const resumingAfterPause = resumeRebaselineIds.has(String(account.profileId));
      let difference = resumingAfterPause
        ? rebaselineAfterResume(posts, account.lastSeenPostId)
        : options.firstLatest ? latestPostOnly(posts) : diffPosts(posts, account.lastSeenPostId);
      if (!resumingAfterPause && !options.firstLatest && account.lastSeenPostId && difference.status === "baseline_missing") {
        const previousBacklog = backlog.accounts[account.searchKey];
        const plan = nextBacklogScan(previousBacklog, account.lastSeenPostId, { manual: options.continueBacklog === true });
        if (plan.scan) {
          // The site exposes no stable public cursor. Continue safely by
          // remembering the boundary and increasing a bounded scan window;
          // merge every discovered post until the saved baseline is proven.
          let deeperPosts = posts;
          if (!fixturePayload) {
            const backlogPayload = JSON.parse(invokeXhs([
              "user-posts", account.profileId, "--json",
              "--until-note", account.lastSeenPostId, "--max-pages", String(plan.scanDepth),
            ]));
            deeperPosts = normalizePosts(backlogPayload, account);
          } else if (Array.isArray(fixturePayload.backlogPages)) {
            deeperPosts = normalizePosts(fixturePayload.backlogPages.slice(0, plan.scanDepth).flat(), account);
          }
          posts = mergeBacklogPosts(previousBacklog?.posts, deeperPosts);
          difference = diffPosts(posts, account.lastSeenPostId);
          if (difference.status === "verified") {
            delete backlog.accounts[account.searchKey];
          } else {
            backlog.accounts[account.searchKey] = {
              baselineId: account.lastSeenPostId,
              state: plan.state,
              scanDepth: plan.scanDepth,
              lastBoundaryId: posts.at(-1)?.id || previousBacklog?.lastBoundaryId || "",
              posts,
              updatedAt: checkedAt,
              reason: plan.state === "manual_required"
                ? "平台没有可靠续页游标，补抓尚未完成，请在采光中点击继续检查"
                : `补抓尚未完成，已保存 ${posts.length} 条和扫描边界；下轮从 ${plan.scanDepth + 1} 批继续`,
            };
            difference = { status: plan.state === "manual_required" ? "baseline_unresolved" : "backlog_incomplete",
              latestPostId: account.lastSeenPostId, newPosts: [] };
          }
        } else {
          posts = mergeBacklogPosts(previousBacklog?.posts, posts);
          difference = { status: "baseline_unresolved", latestPostId: account.lastSeenPostId, newPosts: [] };
        }
      }
      if (difference.status === "verified") delete backlog.accounts[account.searchKey];
      // Persist each account boundary immediately: an interrupted later account
      // must not discard earlier scanning work from this run.
      if (options.write) await atomicJson(backlogPath, { ...backlog, schemaVersion: 1, updatedAt: checkedAt });
      checks.push({ accountKey: account.searchKey, checkedAt, status: difference.status, latestPostId: difference.latestPostId,
        ...(resumingAfterPause ? { resumedFromPause: true } : {}),
        ...(["baseline_missing", "backlog_incomplete", "baseline_unresolved"].includes(difference.status)
          ? { error: backlog.accounts[account.searchKey]?.reason || "补抓尚未完成；本轮不推进基线" } : {}) });
      for (const post of captureCandidates(posts, difference.newPosts, queue.tasks, account.searchKey)) {
        pendingTasks.push({ id: `note-${post.id}`, type: "note", status: "pending", accountKey: account.searchKey,
          title: post.title, slug: slugFor(account, post), sourceUrl: post.sourceUrl,
          captureDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()) });
      }
      consecutiveSafetyErrors = 0;
      consecutiveTransientErrors = 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const detail = message.split("\n").map((line) => line.trim()).filter(Boolean).at(-1) || "未知发现错误";
      checks.push({ accountKey: account.searchKey, checkedAt, status: "discovery_failed", latestPostId: account.lastSeenPostId,
        error: detail });
      consecutiveSafetyErrors = isSafetyStopError(detail) ? consecutiveSafetyErrors + 1 : 0;
      consecutiveTransientErrors = isTransientBrowserFailure(detail) ? consecutiveTransientErrors + 1 : 0;
      if (consecutiveSafetyErrors >= 2) {
        safetyStopped = true;
        for (const deferred of selected.slice(accountIndex + 1)) {
          checks.push({ accountKey: deferred.searchKey, checkedAt, status: "deferred_safety_stop", latestPostId: deferred.lastSeenPostId,
            error: "连续出现登录或访问限制，已停止本轮检查以保护账号" });
        }
        break;
      }
      if (consecutiveTransientErrors >= 2) {
        transientStopped = true;
        for (const deferred of selected.slice(accountIndex + 1)) {
          checks.push({ accountKey: deferred.searchKey, checkedAt, status: "deferred_transient_timeout", latestPostId: deferred.lastSeenPostId,
            error: "连续两个账号响应超时，已停止本轮检查；已完成结果已保存，稍后只补抓未完成账号" });
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
    // Account checks are deliberately paced. Merge into the latest queue so a
    // parallel review/capture cannot be reverted by the older initial snapshot.
    const liveQueue = await readJson(queuePath);
    const selectedKeys = new Set(selected.map((account) => account.searchKey));
    liveQueue.checkedAccounts = [...liveQueue.checkedAccounts.filter((check) => !selectedKeys.has(check.accountKey)), ...checks];
    liveQueue.tasks = mergeDiscoveredTasks(liveQueue.tasks, pendingTasks);
    await atomicJson(queuePath, liveQueue);
    await atomicJson(backlogPath, { ...backlog, schemaVersion: 1, updatedAt: checkedAt });
    const completedResumeKeys = new Set(checks
      .filter((check) => check.resumedFromPause && check.status === "verified")
      .map((check) => check.accountKey));
    if (completedResumeKeys.size) {
      // Advance this baseline here instead of waiting for the capture phase.
      // Old queued work may still exist for the account and must not prevent a
      // successful pause/resume calibration from being committed.
      const livePins = await readJson(pinsPath);
      const completedProfileIds = new Set();
      for (const account of livePins.accounts || []) {
        if (!completedResumeKeys.has(account.searchKey)) continue;
        const check = checks.find((item) => item.accountKey === account.searchKey && item.resumedFromPause && item.status === "verified");
        if (!check?.latestPostId) continue;
        account.lastSeenPostId = check.latestPostId;
        account.lastCheckedAt = check.checkedAt || checkedAt;
        account.status = "verified";
        completedProfileIds.add(String(account.profileId));
      }
      livePins.updatedAt = checkedAt;
      await atomicJson(pinsPath, livePins);
      const livePreferences = await readJson(preferencesPath).catch(() => ({}));
      livePreferences.rebaselineOnResumeProfileIds = (livePreferences.rebaselineOnResumeProfileIds || [])
        .map(String).filter((profileId) => !completedProfileIds.has(profileId));
      livePreferences.updatedAt = new Date().toISOString();
      await atomicJson(preferencesPath, livePreferences);
    }
  }
  const deferredStatuses = new Set(["deferred_safety_stop", "deferred_transient_timeout"]);
  return { ok: checks.every((check) => check.status === "verified"), status: options.write ? "written" : "dry_run",
    checked: checks.filter((check) => !deferredStatuses.has(check.status)).length, total: selected.length,
    failed: checks.filter((check) => check.status === "discovery_failed").length,
    deferred: checks.filter((check) => deferredStatuses.has(check.status)).length,
    added: pendingTasks.length, ratePolicy, safetyStopped, transientStopped, checks, tasks: pendingTasks };
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
