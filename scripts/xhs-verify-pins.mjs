import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { normalizePosts, postIdTimestamp, profileIdentity, profileIdentityFromPosts } from "./xhs-discover.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pinsPath = path.join(root, "data", "xhs-account-pins.json");
const workspacePendingPath = path.join(root, "data", "xhs-pending-pins.json");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const appPendingPath = path.join(appData, "data", "xhs-pending-pins.json");
const preferencesPath = path.join(appData, "data", "user-preferences.json");
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
    env: { ...process.env, XHS_CLI_CONFIG_DIR: cliConfig, XHS_CLI_DISABLE_BROWSER_COOKIE: "1", NO_COLOR: "1" },
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
  const expectedId = usableExpected(pending.xiaohongshuId);
  if (expectedId && expectedId !== identity.xiaohongshuId) return `小红书号不一致：${identity.xiaohongshuId}`;
  return "";
}

export async function verifyPendingPins(options = {}) {
  const pins = await readJson(pinsPath, { version: 1, accounts: [] });
  const workspacePending = await readJson(workspacePendingPath, { schemaVersion: 1, accounts: [] });
  const appPending = await readJson(appPendingPath, { schemaVersion: 1, accounts: [] });
  const pendingById = new Map();
  for (const account of [...(workspacePending.accounts || []), ...(appPending.accounts || [])]) {
    const profileId = profileIdFrom(account);
    if (profileId && account.status === "pending_verification") pendingById.set(profileId, { ...account, profileId });
  }
  if (!pendingById.size) return { ok: true, checked: 0, verified: 0, failed: 0, results: [] };

  try { runXhs(["status"]); } catch {
    return { ok: false, status: "login_required", checked: 0, verified: 0, failed: pendingById.size, results: [] };
  }

  const now = new Date().toISOString();
  const results = [];
  const verifiedIds = new Set();
  for (const [profileId, pending] of pendingById) {
    try {
      const profilePayload = JSON.parse(runXhs(["user", profileId, "--json"]));
      const postsPayload = JSON.parse(runXhs(["user-posts", profileId, "--json"]));
      const identity = mergeIdentity(profileIdentity(profilePayload), profileIdentityFromPosts(postsPayload), profileId);
      const identityError = validateIdentity(pending, identity, profileId);
      if (identityError) throw new Error(identityError);
      const posts = normalizePosts(postsPayload, { searchKey: identity.xiaohongshuId });
      const lastSeenPostId = newestPostId(posts);
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
      verifiedIds.add(profileId);
      results.push({ profileId, status: "verified", displayName: identity.displayName, xiaohongshuId: identity.xiaohongshuId, lastSeenPostId });
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
    const pendingDocument = { schemaVersion: 1, updatedAt: now, accounts: remaining };
    await atomicJson(workspacePendingPath, pendingDocument);
    await atomicJson(appPendingPath, pendingDocument);
    const preferences = await readJson(preferencesPath, null);
    if (preferences) {
      preferences.pinnedAccountIds = [...new Set([...(preferences.pinnedAccountIds || []), ...verifiedIds])];
      preferences.updatedAt = now;
      await atomicJson(preferencesPath, preferences);
    }
  }
  const failed = results.filter((item) => item.status !== "verified").length;
  return { ok: failed === 0, status: options.write ? "written" : "dry_run", checked: results.length,
    verified: results.length - failed, failed, results };
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
