import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { atomicJson, readJson, recoverReviewOperationUnlocked, withReviewStateLock } from "./review-state-store.mjs";

const exists = (filename) => access(filename).then(() => true).catch(() => false);
const isInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export function dateKeyInTimeZone(value = new Date(), timeZone = "Asia/Shanghai") {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isBeforeCleanupDate(entry, beforeDate) {
  if (!beforeDate) return true;
  const decisionDate = dateKeyInTimeZone(entry?.updatedAt);
  // Entries without a usable timestamp came from an older build and predate
  // this daily-boundary policy, so the next real capture may retire them.
  return !decisionDate || decisionDate < beforeDate;
}

export async function cleanupReviewedMedia(dataHome, { beforeDate } = {}) {
  const dataRoot = path.resolve(dataHome);
  return withReviewStateLock(dataRoot, async () => {
    await recoverReviewOperationUnlocked(dataRoot);
    const reviewRoot = path.join(dataRoot, "review");
    const trashRoot = path.join(dataRoot, "trash");
    const registryPath = path.join(dataRoot, "data", "generated-review-items.json");
    const decisionsPath = path.join(dataRoot, "data", "review-decisions.json");
    const trashIndexPath = path.join(dataRoot, "data", "review-trash.json");
    const operationPath = path.join(dataRoot, "data", "review-operation.json");
    let registry = await readJson(registryPath, []);
    let decisions = await readJson(decisionsPath, {});
    let trashIndex = await readJson(trashIndexPath, {});

    // Rejected items remain in the review registry during the session so the
    // UI can move them to the bottom instead of making them disappear. The
    // next cleanup closes that undo window with the existing crash-safe
    // journal, then permanently removes the temporary copy below.
    const rejectedToPurge = new Set();
    for (const [itemIndex, item] of registry.entries()) {
      const decision = decisions[item.id];
      if (decision?.decision !== "rejected" || !isBeforeCleanupDate(decision, beforeDate)) continue;
      rejectedToPurge.add(item.id);
      const localFile = item.galleryLocalPaths?.[0] || item.localPath || item.videoLocalPath;
      const originalFolder = localFile ? path.dirname(path.resolve(localFile)) : "";
      const safeId = String(item.id).replace(/[^a-zA-Z0-9_-]+/g, "-");
      const trashFolder = path.join(trashRoot, `${Date.now()}-${safeId}`);
      await atomicJson(operationPath, {
        type: "reject",
        id: item.id,
        item,
        itemIndex,
        originalFolder,
        trashFolder,
        startedAt: new Date().toISOString(),
      });
      await recoverReviewOperationUnlocked(dataRoot);
    }

    registry = await readJson(registryPath, []);
    decisions = await readJson(decisionsPath, {});
    trashIndex = await readJson(trashIndexPath, {});
    const keptIds = new Set(Object.entries(decisions)
      .filter(([, entry]) => entry?.decision === "kept" && isBeforeCleanupDate(entry, beforeDate))
      .map(([id]) => id));
    const removedIds = [];

    const nextTrashIndex = { ...trashIndex };
    const cleanupAt = new Date().toISOString();
    let purgedRejected = 0;
    for (const [id, entry] of Object.entries(trashIndex)) {
      if (entry?.recoverable === false || ["purged", "missing"].includes(entry?.state)) continue;
      if (!rejectedToPurge.has(id) && !isBeforeCleanupDate(decisions[id], beforeDate)) continue;
      const folder = entry?.trashFolder;
      if (folder && isInside(trashRoot, folder)) await rm(folder, { recursive: true, force: true });
      purgedRejected += 1;
      nextTrashIndex[id] = {
        state: "purged",
        recoverable: false,
        itemId: id,
        itemIndex: entry?.itemIndex,
        deletedAt: entry?.deletedAt,
        purgedAt: cleanupAt,
        reason: "撤回期已结束，文件已清理",
      };
      decisions[id] = {
        ...(decisions[id] || {}),
        decision: "rejected",
        recoverable: false,
        cleanupState: "purged",
        reason: "撤回期已结束，文件已清理",
        updatedAt: cleanupAt,
      };
    }

    const remaining = [];
    for (const item of Array.isArray(registry) ? registry : []) {
      if (!keptIds.has(item.id)) {
        remaining.push(item);
        continue;
      }
      const localFile = item.galleryLocalPaths?.[0] || item.localPath || item.videoLocalPath;
      const folder = localFile ? path.dirname(path.resolve(localFile)) : "";
      if (folder && isInside(reviewRoot, folder)) await rm(folder, { recursive: true, force: true });
      removedIds.push(item.id);
    }

    if (remaining.length !== registry.length || !(await exists(registryPath))) await atomicJson(registryPath, remaining);
    await atomicJson(trashIndexPath, nextTrashIndex);
    await atomicJson(decisionsPath, decisions);
    await mkdir(trashRoot, { recursive: true });
    return { ok: true, removedKept: removedIds.length, purgedRejected };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
  // This CLI is invoked as the first step of a real capture. Only decisions
  // from earlier Shanghai calendar days are eligible for cleanup.
  const beforeDate = dateKeyInTimeZone(new Date());
  console.log(JSON.stringify(await cleanupReviewedMedia(dataHome, { beforeDate })));
}
