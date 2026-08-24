export const MAX_H5_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 15 * 60 * 1000;

export function h5TaskIsDue(task, now = new Date()) {
  if (!["pending", "needs_h5_capture", "retry_pending"].includes(task.status)) return false;
  if (task.status !== "retry_pending" || !task.nextAttemptAt) return true;
  return new Date(task.nextAttemptAt).getTime() <= now.getTime();
}

export function scheduleH5Retry(task, error, now = new Date()) {
  const attempts = Number(task.attempts || 0) + 1;
  task.attempts = attempts;
  task.lastAttemptAt = now.toISOString();
  task.lastError = error;
  task.error = error;
  if (attempts >= MAX_H5_ATTEMPTS) {
    task.status = "failed";
    task.failedAt = now.toISOString();
    delete task.nextAttemptAt;
    return { terminal: true, attempts };
  }
  task.status = "retry_pending";
  const delay = BASE_RETRY_DELAY_MS * (2 ** (attempts - 1));
  task.nextAttemptAt = new Date(now.getTime() + delay).toISOString();
  delete task.failedAt;
  return { terminal: false, attempts, nextAttemptAt: task.nextAttemptAt };
}

export function clearH5Retry(task) {
  for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "failedAt"]) delete task[key];
}
