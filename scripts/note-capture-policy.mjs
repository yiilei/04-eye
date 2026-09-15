export const MAX_NOTE_ATTEMPTS = 3;
const BASE_NOTE_RETRY_DELAY_MS = 15 * 60 * 1000;
const AUTOMATIC_NOTE_STATUSES = new Set(["pending", "retry_pending"]);
const MANUAL_NOTE_STATUSES = new Set(["needs_browser_capture", "user_action_required", "failed"]);
const ACCOUNT_RECOVERABLE_STATUSES = new Set([
  "pending", "retry_pending", "needs_browser_capture", "user_action_required", "failed",
  "waiting_for_account_verification", "account_unavailable", "account_paused",
]);

export function classifyNoteCaptureFailure(message) {
  const text = String(message || "").toLowerCase();
  if (/登录|login_required|not logged|cookie.*失效/.test(text)) {
    return { category: "login_required", action: "user_action_required" };
  }
  if (/验证码|captcha|verification|required|权限|permission|forbidden|无权访问/.test(text)) {
    return { category: "verification_or_permission", action: "user_action_required" };
  }
  if (/notedetailmap|failed to extract note detail|解析字段|parser incompatible/.test(text)) {
    return { category: "parser_incompatible", action: "browser_capture" };
  }
  if (/成功 0 个|获取数据失败|empty result|timeout|timed out|超时|network|connection|连接|temporar|reset|429|502|503|504/.test(text)) {
    return { category: "transient_network", action: "retry" };
  }
  return { category: "capture_unknown", action: "retry" };
}

export function noteTaskIsDue(task, now = new Date(), options = {}) {
  if (options.manual === true && MANUAL_NOTE_STATUSES.has(task.status)) return true;
  if (!AUTOMATIC_NOTE_STATUSES.has(task.status)) return false;
  if (task.status !== "retry_pending" || !task.nextAttemptAt) return true;
  return new Date(task.nextAttemptAt).getTime() <= now.getTime();
}

export function reconcileNoteTaskAccount(task, account, pendingAccount, now = new Date(), options = {}) {
  if (task.type !== "note" || !ACCOUNT_RECOVERABLE_STATUSES.has(task.status)) return { changed: false };
  let changed = false;
  const oldAttempts = Number(task.attempts || 0);
  if (oldAttempts > MAX_NOTE_ATTEMPTS) {
    task.attempts = MAX_NOTE_ATTEMPTS;
    changed = true;
  }
  if (options.enabled === false) {
    const message = `账号 ${task.accountKey} 已暂停埋点，重新开启后会继续未完成任务`;
    if (task.status !== "account_paused" || task.failureType !== "account_paused" || task.error !== message) changed = true;
    task.status = "account_paused";
    task.failureType = "account_paused";
    task.error = message;
    task.lastError = message;
    delete task.nextAttemptAt;
    if (changed) task.lastAttemptAt = now.toISOString();
    return { changed, action: "pause", terminal: false, category: "account_paused", message };
  }
  if (account?.status === "verified") {
    if (["waiting_for_account_verification", "account_unavailable", "account_paused"].includes(task.status)) {
      task.status = "pending";
      clearNoteFailure(task);
      return { changed: true, action: "reopened", terminal: false };
    }
    return { changed };
  }
  const awaitingVerification = pendingAccount?.status === "pending_verification" || account?.status === "pending_verification";
  const status = awaitingVerification ? "waiting_for_account_verification" : "account_unavailable";
  const category = awaitingVerification ? "account_pending_verification" : account ? "account_not_verified" : "account_removed";
  const message = awaitingVerification
    ? `账号 ${task.accountKey} 尚待验证，验证成功后将自动恢复任务`
    : account
      ? `账号 ${task.accountKey} 当前不可用（${account.status || "状态未知"}），任务已暂停`
      : `账号 ${task.accountKey} 已不在埋点列表，旧任务已停止重试`;
  if (task.status !== status || task.failureType !== category || task.error !== message) changed = true;
  task.status = status;
  task.failureType = category;
  task.error = message;
  task.lastError = message;
  if (changed) task.lastAttemptAt = now.toISOString();
  delete task.nextAttemptAt;
  return { changed, action: awaitingVerification ? "wait" : "stop", terminal: !awaitingVerification, category, message };
}

export function transitionNoteFailure(task, message, now = new Date()) {
  const classification = classifyNoteCaptureFailure(message);
  task.lastError = message;
  task.error = message;
  task.lastAttemptAt = now.toISOString();
  task.failureType = classification.category;

  if (classification.action === "browser_capture") {
    task.status = "needs_browser_capture";
    delete task.nextAttemptAt;
    return { ...classification, terminal: false };
  }
  if (classification.action === "user_action_required") {
    task.status = "user_action_required";
    delete task.nextAttemptAt;
    return { ...classification, terminal: true };
  }

  const attempts = Math.min(MAX_NOTE_ATTEMPTS, Number(task.attempts || 0) + 1);
  task.attempts = attempts;
  if (attempts >= MAX_NOTE_ATTEMPTS) {
    task.status = "needs_browser_capture";
    task.failureType = "network_retries_exhausted";
    delete task.nextAttemptAt;
    return { category: task.failureType, action: "browser_capture", terminal: false, attempts };
  }
  task.status = "retry_pending";
  task.nextAttemptAt = new Date(now.getTime() + BASE_NOTE_RETRY_DELAY_MS * (2 ** (attempts - 1))).toISOString();
  return { ...classification, terminal: false, attempts, nextAttemptAt: task.nextAttemptAt };
}

export function resetRecoverableNoteTask(task) {
  if (!["needs_browser_capture", "retry_pending", "user_action_required", "failed"].includes(task.status)) return false;
  task.status = "pending";
  clearNoteFailure(task);
  return true;
}

export function clearNoteFailure(task) {
  for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "failedAt", "failureType", "error", "diagnosticsPath"]) delete task[key];
}
