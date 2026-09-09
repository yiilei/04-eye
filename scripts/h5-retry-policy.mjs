export const MAX_H5_FAILURE_DAYS = 3;
export const MAX_H5_ATTEMPTS = MAX_H5_FAILURE_DAYS;

const ACTIVE_STATUSES = new Set(["pending", "needs_h5_capture", "retry_pending", "fallback_pending", "deferred_next_day"]);
const MANUAL_STATUSES = new Set(["content_not_published", "manual_only", "rule_changed", "auth_required", "verification_required", "risk_paused"]);

export function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
}

function followingDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function classifyH5Failure(error) {
  const text = String(error || "").toLowerCase();
  if (/登录|login_required|not logged|cookie.*失效/.test(text)) return { category: "login_required", action: "user_action" };
  if (/验证码|captcha|verification.required/.test(text)) return { category: "verification_required", action: "user_action" };
  if (/429|反爬|访问频繁|risk.control|risk_control/.test(text)) return { category: "risk_paused", action: "user_action" };
  if (/活动已下线|明确.*删除|确认.*失效|链接已失效/.test(text)) return { category: "unavailable", action: "stop" };
  if (/detail_url_unresolved|activity_url_unavailable|h5 尚未发布|activity_unpublished|正文.*未上线|尚未发布|应用不存在/.test(text)) {
    return { category: "content_not_published", action: "defer" };
  }
  if (/页面结构|selector|解析规则|parser.incompatible|无法识别页面/.test(text)) return { category: "rule_changed", action: "user_action" };
  if (/timeout|timed out|超时|network|connection|连接|temporar|reset|502|503|504|空白|empty/.test(text)) {
    return { category: "transient_network", action: "defer", immediateRetry: true };
  }
  return { category: "capture_unknown", action: "defer", immediateRetry: true };
}

export function h5TaskIsDue(task, now = new Date(), options = {}) {
  if (options.manual === true && (ACTIVE_STATUSES.has(task.status) || MANUAL_STATUSES.has(task.status))) return true;
  if (!ACTIVE_STATUSES.has(task.status)) return false;
  if (["pending", "needs_h5_capture"].includes(task.status)) return true;
  const today = shanghaiDate(now);
  if (task.nextEligibleDate) return task.nextEligibleDate <= today;
  // Old builds stored six-hour timers. Migrate them to at most one attempt on
  // the following calendar day instead of waking the full pipeline that night.
  if (task.lastAttemptAt) return shanghaiDate(new Date(task.lastAttemptAt)) < today;
  return true;
}

export function transitionH5Failure(task, error, now = new Date()) {
  const classification = classifyH5Failure(error);
  const today = shanghaiDate(now);
  task.lastAttemptAt = now.toISOString();
  task.lastError = error;
  task.error = error;
  task.failureType = classification.category;
  delete task.nextAttemptAt;
  delete task.failedAt;

  if (classification.action === "stop") {
    task.status = "unavailable";
    delete task.nextEligibleDate;
    return { ...classification, terminal: true };
  }
  if (classification.action === "user_action") {
    task.status = classification.category;
    delete task.nextEligibleDate;
    return { ...classification, terminal: true };
  }

  if (task.lastFailureDate !== today) task.failureDays = Number(task.failureDays || 0) + 1;
  task.lastFailureDate = today;
  if (task.failureDays >= MAX_H5_FAILURE_DAYS) {
    task.status = classification.category === "content_not_published" ? "content_not_published" : "manual_only";
    delete task.nextEligibleDate;
    return { ...classification, terminal: true, failureDays: task.failureDays };
  }
  task.status = "deferred_next_day";
  task.nextEligibleDate = followingDate(today);
  return { ...classification, terminal: false, failureDays: task.failureDays, nextEligibleDate: task.nextEligibleDate };
}

export function clearH5Retry(task) {
  for (const key of ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "nextEligibleDate", "failedAt",
    "failureType", "failureDays", "lastFailureDate", "error"]) delete task[key];
}

// Compatibility exports used by older packaged runtimes. They now follow the
// bounded daily policy; neither function creates another six-hour wake-up.
export const h5FailureIsPermanent = (error) => ["content_not_published", "unavailable"].includes(classifyH5Failure(error).category);
export const scheduleH5PublicationRetry = transitionH5Failure;
export function scheduleH5Retry(task, error, now = new Date()) {
  const result = transitionH5Failure(task, error, now);
  return { ...result, attempts: Number(task.failureDays || 1), nextAttemptAt: undefined };
}
