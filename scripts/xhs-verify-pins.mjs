import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { latestPostOnly, mergeDiscoveredTasks, normalizePosts, postIdTimestamp, profileIdentity, profileIdentityFromPosts } from "./xhs-discover.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const pinsPath = path.join(appData, "data", "xhs-account-pins.json");
const appPendingPath = path.join(appData, "data", "xhs-pending-pins.json");
const preferencesPath = path.join(appData, "data", "user-preferences.json");
const queuePath = path.join(appData, "data", "xhs-capture-queue.json");
const starterPinsPath = path.join(root, "data", "xhs-account-pins.json");
const xhsExecutable = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "xhs");
const cliConfig = path.join(appData, "xhs-cli");

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
};
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

function runXhs(args) {
  return execFileSync(xhsExecutable, args, {
    cwd: root, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, XHS_CLI_CONFIG_DIR: cliConfig, XHS_CLI_DISABLE_BROWSER_COOKIE: process.env.XHS_CLI_DISABLE_BROWSER_COOKIE ?? "0", CAIGUANG_CHROME_FALLBACK: process.env.CAIGUANG_CHROME_FALLBACK ?? "1", NO_COLOR: "1" },
  }).trim();
}

function profileIdFrom(account) {
  return String(account?.profileId || account?.profileUrl?.match(/\/user\/profile\/([^/?#]+)/)?.[1] || "");
}

function usableExpected(value) {
  const normalized = String(value || "").trim();
  return normalized && !["待验证", "待晚间核验", "待核验账号"].includes(normalized) ? normalized : "";
}

function newestPostId(posts) {
  if (!posts.length) return "";
  return [...posts].sort((left, right) => postIdTimestamp(right.id) - postIdTimestamp(left.id))[0]?.id || posts[0]?.id || "";
}

function firstCapturePost(posts) {
  return latestPostOnly(posts).newPosts[0]
    || [...posts].sort((left, right) => postIdTimestamp(right.id) - postIdTimestamp(left.id))[0];
}

function slugFor(account, post) {
  const safeAccount = account.xiaohongshuId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `xhs-${safeAccount}-${post.id}`;
}

async function persistVerifiedManualAccounts(pins, verifiedRecords, now) {
  const preferences = await readJson(preferencesPath, null);
  if (!preferences) return;
  const starterPins = await readJson(starterPinsPath, { accounts: [] });
  const starterProfileIds = new Set((starterPins.accounts || []).map((account) => profileIdFrom(account)).filter(Boolean));
  const manualAccounts = new Map((preferences.manualPinAccounts || [])
    .map((account) => [profileIdFrom(account), account]).filter(([profileId]) => profileId));
  for (const record of pins.accounts || []) {
    const profileId = profileIdFrom(record);
    if (record.status === "verified" && profileId && !starterProfileIds.has(profileId)) {
      manualAccounts.set(profileId, { ...manualAccounts.get(profileId), ...record });
    }
  }
  for (const [profileId, record] of verifiedRecords) manualAccounts.set(profileId, { ...manualAccounts.get(profileId), ...record });
  preferences.pinnedAccountIds = [...new Set([...(preferences.pinnedAccountIds || []), ...verifiedRecords.keys()])];
  preferences.manualPinAccounts = [...manualAccounts.values()];
  preferences.updatedAt = now;
  await atomicJson(preferencesPath, preferences);
}

function mergeIdentity(primary, fallback, profileId) {
  return {
    displayName: primary.displayName || fallback.displayName,
    xiaohongshuId: primary.xiaohongshuId || fallback.xiaohongshuId,
    profileId: primary.profileId || fallback.profileId || profileId,
  };
}

function validateIdentity(pending, identity, profileId) {
  if (!identity.displayName) return "主页未返回账号名称";
  if (!identity.xiaohongshuId) return "主页未返回小红书号";
  if (identity.profileId && identity.profileId !== profileId) return `内部 ID 不一致：${identity.profileId}`;
  const expectedName = usableExpected(pending.displayName);
  if (expectedName && expectedName !== identity.displayName) return `账号名称不一致：${identity.displayName}`;
  const expectedId = usableExpected(pending.xiaohongshuId);
  if (expectedId && expectedId !== identity.xiaohongshuId) return `小红书号不一致：${identity.xiaohongshuId}`;
  return "";
}

export async function verifyPendingPins(options = {}) {
  const pins = await readJson(pinsPath, { version: 1, accounts: [] });
  const appPending = await readJson(appPendingPath, { schemaVersion: 1, accounts: [] });
  const pendingById = new Map();
  for (const account of appPending.accounts || []) {
    const profileId = profileIdFrom(account);
    if (profileId && account.status === "pending_verification") pendingById.set(profileId, { ...account, profileId });
  }
  if (!pendingById.size) {
    if (options.write) await persistVerifiedManualAccounts(pins, new Map(), new Date().toISOString());
    return { ok: true, checked: 0, verified: 0, failed: 0, queued: 0, results: [] };
  }

  const invokeXhs = options.xhsRunner || runXhs;
  try { invokeXhs(["status"]); } catch {
    return { ok: false, status: "login_required", checked: 0, verified: 0, failed: pendingById.size, results: [] };
  }

  const now = new Date().toISOString();
  const results = [];
  const verifiedIds = new Set();
  const verifiedRecords = new Map();
  const firstCaptureTasks = [];
  for (const [profileId, pending] of pendingById) {
    try {
      const postsPayload = JSON.parse(invokeXhs(["user-posts", profileId, "--json"]));
      const postsIdentity = profileIdentityFromPosts(postsPayload);
      let profilePayload = {};
      const postsAreEnough = postsIdentity.displayName
        && postsIdentity.profileId === profileId
        && usableExpected(pending.xiaohongshuId);
      if (!postsAreEnough) {
        try { profilePayload = JSON.parse(invokeXhs(["user", profileId, "--json"])); } catch { /* posts provide a fixed-profile fallback */ }
      }
      const pendingIdentity = {
        displayName: usableExpected(pending.displayName),
        xiaohongshuId: usableExpected(pending.xiaohongshuId),
        profileId,
      };
      const identity = mergeIdentity(profileIdentity(profilePayload), mergeIdentity(postsIdentity, pendingIdentity, profileId), profileId);
      const identityError = validateIdentity(pending, identity, profileId);
      if (identityError) throw new Error(identityError);
      const posts = normalizePosts(postsPayload, { searchKey: identity.xiaohongshuId });
      const firstPost = firstCapturePost(posts);
      const lastSeenPostId = firstPost?.id || newestPostId(posts);
      if (!lastSeenPostId) throw new Error("账号暂无可作为基线的公开帖子");

      const record = {
        searchKey: identity.xiaohongshuId,
        xiaohongshuId: identity.xiaohongshuId,
        displayName: identity.displayName,
        group: "manual",
        profileId,
        profileUrl: `https://www.xiaohongshu.com/user/profile/${profileId}`,
        ...(pending.avatarUrl ? { avatarUrl: pending.avatarUrl } : {}),
        lastSeenPostId,
        lastCheckedAt: now,
        status: "verified",
      };
      const existingIndex = pins.accounts.findIndex((account) => account.profileId === profileId);
      if (existingIndex >= 0) pins.accounts[existingIndex] = { ...pins.accounts[existingIndex], ...record };
      else pins.accounts.push(record);
      verifiedRecords.set(profileId, record);
      firstCaptureTasks.push({ id: `note-${firstPost.id}`, type: "note", status: "pending", accountKey: record.searchKey,
        title: firstPost.title || `${record.displayName} 最新帖子`, slug: slugFor(record, firstPost), sourceUrl: firstPost.sourceUrl,
        captureDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date()),
        firstCaptureForPin: true });
      verifiedIds.add(profileId);
      results.push({ profileId, status: "verified", displayName: identity.displayName, xiaohongshuId: identity.xiaohongshuId,
        lastSeenPostId, queuedPostId: firstPost.id });
    } catch (error) {
      const message = error instanceof Error ? error.message.split("\n").filter(Boolean).at(-1) : String(error);
      pendingById.set(profileId, { ...pending, lastVerificationAttemptAt: now, verificationError: message });
      results.push({ profileId, status: "verification_failed", error: message });
    }
  }

  const remaining = [...pendingById.values()].filter((account) => !verifiedIds.has(account.profileId));
  if (options.write) {
    pins.updatedAt = now;
    await atomicJson(pinsPath, pins);
    const queue = await readJson(queuePath, { version: 1, checkedAccounts: [], tasks: [] });
    queue.tasks = mergeDiscoveredTasks(queue.tasks || [], firstCaptureTasks);
    await atomicJson(queuePath, queue);
    const pendingDocument = { schemaVersion: 1, updatedAt: now, accounts: remaining };
    await atomicJson(appPendingPath, pendingDocument);
    await persistVerifiedManualAccounts(pins, verifiedRecords, now);
  }
  const failed = results.filter((item) => item.status !== "verified").length;
  return { ok: failed === 0, status: options.write ? "written" : "dry_run", checked: results.length,
    verified: results.length - failed, failed, queued: firstCaptureTasks.length, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPendingPins({ write: process.argv.includes("--write") }).then((result) => {
    console.log(JSON.stringify(result));
    if (!result.ok) process.exitCode = 1;
  }).catch((error) => {
    console.error(JSON.stringify({ ok: false, status: "error", error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
