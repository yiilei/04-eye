import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const updateStatusPath = (dataHome) => path.join(dataHome, "data", "update-status.json");

export async function readUpdateStatus(dataHome) {
  try { return JSON.parse(await readFile(updateStatusPath(dataHome), "utf8")); }
  catch { return { schemaVersion: 1, state: "idle" }; }
}

export async function recordUpdateCheck(dataHome, result, {
  source = "manual",
  localDate,
  timestamp = Date.now(),
} = {}) {
  const existing = await readUpdateStatus(dataHome);
  const checkedAt = new Date(timestamp).toISOString();
  const successful = result?.state === "available" || result?.state === "latest";
  const schedulerAttempt = source === "scheduler";
  const attemptsToday = schedulerAttempt
    ? (existing.schedulerAttemptDate === localDate ? Number(existing.schedulerAttemptsToday || 0) : 0) + 1
    : Number(existing.schedulerAttemptsToday || 0);
  const nextRetry = schedulerAttempt && !successful && attemptsToday < 2
    ? new Date(timestamp + 2 * 60 * 60_000).toISOString()
    : null;
  const record = {
    ...existing,
    schemaVersion: 1,
    state: result?.state || "unavailable",
    currentVersion: result?.currentVersion || existing.currentVersion || "",
    latestVersion: result?.latestVersion || "",
    releaseUrl: result?.releaseUrl || null,
    downloadUrl: result?.downloadUrl || null,
    message: result?.message || "",
    checkedAt,
    source,
    ...(successful && localDate ? { lastSuccessfulCheckDate: localDate } : {}),
    ...(schedulerAttempt ? {
      schedulerAttemptDate: localDate,
      schedulerAttemptsToday: attemptsToday,
      schedulerNextAttemptAt: nextRetry,
    } : {}),
  };
  if (successful) record.schedulerNextAttemptAt = null;
  const target = updateStatusPath(dataHome);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, target);
  return record;
}
