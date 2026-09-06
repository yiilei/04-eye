export function schedulerEnabled(preferences) {
  return preferences?.automaticCaptureEnabled === true && preferences?.onboardingComplete !== false;
}

export function captureIsDue(preferences, state, now, retryDue = false) {
  if (state.nextCaptureAttemptAt && Date.parse(state.nextCaptureAttemptAt) > (now.timestamp ?? Date.now())) return false;
  const yesterday = new Date(Date.parse(`${now.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const missedPreviousDay = state.lastCaptureDate && (state.lastCaptureDate < yesterday
    || (state.lastCaptureDate < now.date && state.lastCaptureStatus === "needs_attention"));
  const failedRunDue = state.lastCaptureStatus === "needs_attention";
  const scheduledTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(state.captureScheduleTime || ""))
    ? state.captureScheduleTime
    : preferences.captureTime;
  return schedulerEnabled(preferences)
    && Boolean(retryDue || failedRunDue || missedPreviousDay || (now.time >= scheduledTime
      && (state.lastCaptureDate !== now.date || state.lastCaptureStatus === "needs_attention")));
}

export function pushIsDue(preferences, state, now) {
  return schedulerEnabled(preferences)
    && now.time >= preferences.pushTime
    && state.lastPushDate !== now.date;
}
