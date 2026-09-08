import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

async function lockIsStale(lockPath, staleAfterMs) {
  const owner = await readJson(lockPath, {});
  const pid = Number(owner.pid);
  if (Number.isInteger(pid) && pid > 1) {
    try { process.kill(pid, 0); return false; }
    catch (error) {
      // ESRCH is the only reliable proof that the owner no longer exists.
      // EPERM and unknown failures mean that the process state cannot be
      // established, so stealing the lock would risk concurrent writes.
      if (error?.code === "ESRCH") return true;
      return false;
    }
  }
  // A freshly-created lock can be observed before its owner JSON has finished
  // writing. Do not steal that live lock; only discard malformed empty locks
  // after a short grace period.
  const metadata = await stat(lockPath).catch(() => null);
  return Boolean(metadata && Date.now() - metadata.mtimeMs > Math.min(staleAfterMs, 5_000));
}

export async function withReviewStateLock(dataHome, callback, {
  timeoutMs = 8_000,
  staleAfterMs = 2 * 60_000,
} = {}) {
  const lockPath = path.join(path.resolve(dataHome), "data", "review-state.lock");
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  let handle;
  while (!handle) {
    try {
      handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await lockIsStale(lockPath, staleAfterMs)) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("批阅资料正在更新，请稍后重试");
      await wait(40);
    }
  }
  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    const owner = await readJson(lockPath, {});
    if (Number(owner.pid) === process.pid) await rm(lockPath, { force: true });
  }
}

const isInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const exists = (filename) => access(filename).then(() => true).catch(() => false);

const itemMediaPaths = (item) => [
  ...(Array.isArray(item?.galleryLocalPaths) ? item.galleryLocalPaths : []),
  item?.localPath,
  item?.videoLocalPath,
  item?.animationLocalPath,
  item?.livePhotoLocalPath,
  ...Object.values(item?.livePhotoLocalPaths || {}),
  ...(Array.isArray(item?.livePhotoVideoLocalPaths) ? item.livePhotoVideoLocalPaths : []),
].filter(Boolean).map((value) => path.resolve(String(value)));

async function requiredFilesExist(item, originalFolder) {
  const required = itemMediaPaths(item).filter((filename) => isInside(originalFolder, filename));
  if (!required.length) return exists(originalFolder);
  return (await Promise.all(required.map(async (filename) => {
    const info = await stat(filename).catch(() => null);
    return Boolean(info?.isFile() && info.size > 0);
  }))).every(Boolean);
}

function missingRecord(operation, originalFolder, trashFolder, reason = "文件缺失") {
  return {
    state: "missing",
    recoverable: false,
    reason,
    itemId: operation.id,
    itemIndex: operation.itemIndex,
    originalFolder,
    trashFolder,
    updatedAt: new Date().toISOString(),
  };
}

export async function recoverReviewOperationUnlocked(dataHome) {
  const root = path.resolve(dataHome);
  const dataDir = path.join(root, "data");
  const operationPath = path.join(dataDir, "review-operation.json");
  let operation;
  try {
    operation = JSON.parse(await readFile(operationPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { recovered: false, status: "none" };
    throw new Error("批阅恢复日志无法读取，已停止后续写入，请保留资料并重试", { cause: error });
  }
  if (!operation?.type || !operation?.id) {
    throw new Error("批阅恢复日志不完整，已停止后续写入");
  }
  const reviewRoot = path.join(root, "review");
  const trashRoot = path.join(root, "trash");
  const registryPath = path.join(dataDir, "generated-review-items.json");
  const decisionsPath = path.join(dataDir, "review-decisions.json");
  const trashIndexPath = path.join(dataDir, "review-trash.json");
  const registry = await readJson(registryPath, []);
  const decisions = await readJson(decisionsPath, {});
  const trashIndex = await readJson(trashIndexPath, {});
  const originalFolder = path.resolve(String(operation.originalFolder || ""));
  const trashFolder = path.resolve(String(operation.trashFolder || ""));
  if (!isInside(reviewRoot, originalFolder) || !isInside(trashRoot, trashFolder)) {
    throw new Error("未完成的批阅操作路径无效，已停止后续写入");
  }
  let originalExists = await exists(originalFolder);
  let trashExists = await exists(trashFolder);

  if (originalExists && trashExists) {
    throw new Error("未完成的批阅操作同时存在原目录和撤回目录，需要人工检查");
  }

  if (operation.type === "reject") {
    if (!trashExists && originalExists) {
      await mkdir(path.dirname(trashFolder), { recursive: true });
      await rename(originalFolder, trashFolder);
      originalExists = false;
      trashExists = true;
    }
    const nextRegistry = registry.filter((item) => item.id !== operation.id);
    if (trashExists) {
      trashIndex[operation.id] = { state: "available", recoverable: true,
        item: operation.item, itemIndex: operation.itemIndex,
        originalFolder, trashFolder, deletedAt: operation.startedAt };
      decisions[operation.id] = { decision: "rejected", updatedAt: operation.startedAt, recoverable: true };
    } else {
      trashIndex[operation.id] = missingRecord(operation, originalFolder, trashFolder);
      decisions[operation.id] = { decision: "rejected", updatedAt: operation.startedAt,
        recoverable: false, cleanupState: "missing", reason: "文件缺失" };
    }
    await atomicJson(registryPath, nextRegistry);
    await atomicJson(trashIndexPath, trashIndex);
    await atomicJson(decisionsPath, decisions);
  } else if (operation.type === "restore") {
    if (!originalExists && trashExists) {
      await mkdir(path.dirname(originalFolder), { recursive: true });
      await rename(trashFolder, originalFolder);
      originalExists = true;
      trashExists = false;
    }
    if (originalExists && await requiredFilesExist(operation.item, originalFolder)) {
      if (!registry.some((item) => item.id === operation.id)) {
        const insertAt = Math.max(0, Math.min(Number(operation.itemIndex) || 0, registry.length));
        registry.splice(insertAt, 0, operation.item);
      }
      delete trashIndex[operation.id];
      delete decisions[operation.id];
    } else {
      for (let index = registry.length - 1; index >= 0; index -= 1) {
        if (registry[index]?.id === operation.id) registry.splice(index, 1);
      }
      const missing = missingRecord(operation, originalFolder, trashFolder,
        originalExists ? "必要文件缺失" : "文件缺失");
      trashIndex[operation.id] = missing;
      decisions[operation.id] = { decision: "rejected", updatedAt: missing.updatedAt,
        recoverable: false, cleanupState: "missing", reason: missing.reason };
    }
    await atomicJson(registryPath, registry);
    await atomicJson(trashIndexPath, trashIndex);
    await atomicJson(decisionsPath, decisions);
  } else {
    throw new Error(`未知的批阅恢复操作：${operation.type}`);
  }
  await rm(operationPath, { force: true });
  return { recovered: true, status: decisions[operation.id]?.cleanupState || operation.type };
}
