export const MAX_NOTE_ATTEMPTS = 3;
const BASE_NOTE_RETRY_DELAY_MS = 15 * 60 * 1000;

export function classifyNoteCaptureFailure(message) {
  const text = String(message || "").toLowerCase();
  if (/登录|login_required|not logged|cookie.*失效/.test(text)) {
    return { category: "login_required", action: "user_action_required" };
  }
  if (/验证码|captcha|verification|required|权限|permission|forbidden|无权访问/.test(text)) {
    return { category: "verification_or_permission", action: "user_action_required" };
  }
  if (/安全限制|notedetailmap|成功 0 个|获取数据失败|failed to extract note detail|解析/.test(text)) {
    return { category: "parser_incompatible", action: "browser_capture" };
  }
  if (/timeout|timed out|超时|network|connection|连接|temporar|reset|429|502|503|504/.test(text)) {
    return { category: "transient_network", action: "retry" };
  }
  return { category: "capture_unknown", action: "browser_capture" };
}

export function noteTaskIsDue(task, now = new Date()) {
  if (!["pending", "retry_pending"].includes(task.status)) return false;
  if (task.status !== "retry_pending" || !task.nextAttemptAt) return true;
  return new Date(task.nextAttemptAt).getTime() <= now.getTime();
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

  const attempts = Number(task.attempts || 0) + 1;
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

export function clearNoteFailure(task) {
  for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "failedAt", "failureType", "error"]) delete task[key];
}
