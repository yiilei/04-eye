export function schedulerEnabled(preferences) {
  return preferences?.automaticCaptureEnabled === true && preferences?.onboardingComplete !== false;
}

export function initialCaptureReady(state) {
  // Older releases did not persist initialCaptureCompletedAt. A successful
  // daily capture is equivalent evidence for an existing installation.
  return Boolean(state?.initialCaptureCompletedAt || state?.lastCaptureDate);
}

export function captureIsDue(preferences, state, now) {
  if (state.nextCaptureAttemptAt && Date.parse(state.nextCaptureAttemptAt) > (now.timestamp ?? Date.now())) return false;
  const yesterday = new Date(Date.parse(`${now.date}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const missedPreviousDay = state.lastCaptureDate && (state.lastCaptureDate < yesterday
    || (state.lastCaptureDate < now.date && state.lastCaptureStatus === "needs_attention"));
  const failedPreviousDay = state.lastCaptureStatus === "needs_attention"
    && Boolean(state.captureFailureDate) && state.captureFailureDate < now.date;
  const failedRunDue = state.lastCaptureStatus === "needs_attention" && Boolean(state.nextCaptureAttemptAt);
  const scheduledTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(state.captureScheduleTime || ""))
    ? state.captureScheduleTime
    : preferences.captureTime;
  return schedulerEnabled(preferences)
    && initialCaptureReady(state)
    && Boolean(failedRunDue || failedPreviousDay || missedPreviousDay || (now.time >= scheduledTime && state.lastCaptureDate !== now.date
      && state.lastCaptureStatus !== "needs_attention"));
}

export function pushIsDue(preferences, state, now) {
  return schedulerEnabled(preferences)
    && initialCaptureReady(state)
    && now.time >= preferences.pushTime
    && state.lastPushDate !== now.date;
}
