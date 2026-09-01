import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const exists = (filename) => access(filename).then(() => true).catch(() => false);
const readJson = async (filename, fallback) => {
  try { return JSON.parse(await readFile(filename, "utf8")); } catch { return fallback; }
};
const atomicJson = async (filename, value) => {
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filename);
};
const isInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};

export async function cleanupReviewedMedia(dataHome) {
  const dataRoot = path.resolve(dataHome);
  const reviewRoot = path.join(dataRoot, "review");
  const trashRoot = path.join(dataRoot, "trash");
  const registryPath = path.join(dataRoot, "data", "generated-review-items.json");
  const decisionsPath = path.join(dataRoot, "data", "review-decisions.json");
  const trashIndexPath = path.join(dataRoot, "data", "review-trash.json");
  const registry = await readJson(registryPath, []);
  const decisions = await readJson(decisionsPath, {});
  const trashIndex = await readJson(trashIndexPath, {});
  const keptIds = new Set(Object.entries(decisions)
    .filter(([, entry]) => entry?.decision === "kept")
    .map(([id]) => id));
  const removedIds = [];

  for (const entry of Object.values(trashIndex)) {
    const folder = entry?.trashFolder;
    if (folder && isInside(trashRoot, folder)) await rm(folder, { recursive: true, force: true });
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
  await atomicJson(trashIndexPath, {});
  await mkdir(trashRoot, { recursive: true });
  return { ok: true, removedKept: removedIds.length, purgedRejected: Object.keys(trashIndex).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
  console.log(JSON.stringify(await cleanupReviewedMedia(dataHome)));
}
