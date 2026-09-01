export const MAX_H5_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 15 * 60 * 1000;
const PUBLICATION_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export function h5TaskIsDue(task, now = new Date()) {
  if (!["pending", "needs_h5_capture", "retry_pending", "fallback_pending"].includes(task.status)) return false;
  if (!["retry_pending", "fallback_pending"].includes(task.status) || !task.nextAttemptAt) return true;
  return new Date(task.nextAttemptAt).getTime() <= now.getTime();
}

export function h5FailureIsPermanent(error) {
  return /activity H5 尚未发布|activity_unpublished|链接已失效/u.test(String(error || ""));
}

export function scheduleH5PublicationRetry(task, error, now = new Date()) {
  task.attempts = Number(task.attempts || 0) + 1;
  task.lastAttemptAt = now.toISOString();
  task.lastError = error;
  task.error = error;
  task.status = "fallback_pending";
  task.nextAttemptAt = new Date(now.getTime() + PUBLICATION_RETRY_DELAY_MS).toISOString();
  delete task.failedAt;
  return { attempts: task.attempts, nextAttemptAt: task.nextAttemptAt };
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
