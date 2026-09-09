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

export async function cleanupReviewedMedia(dataHome) {
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
    for (const [itemIndex, item] of registry.entries()) {
      if (decisions[item.id]?.decision !== "rejected") continue;
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
      .filter(([, entry]) => entry?.decision === "kept")
      .map(([id]) => id));
    const removedIds = [];

    const nextTrashIndex = { ...trashIndex };
    const cleanupAt = new Date().toISOString();
    let purgedRejected = 0;
    for (const [id, entry] of Object.entries(trashIndex)) {
      if (entry?.recoverable === false || ["purged", "missing"].includes(entry?.state)) continue;
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
  console.log(JSON.stringify(await cleanupReviewedMedia(dataHome)));
}
