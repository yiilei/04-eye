export function schedulerEnabled(preferences) {
  return preferences?.automaticCaptureEnabled === true && preferences?.onboardingComplete !== false;
}

export function captureIsDue(preferences, state, now, retryDue = false) {
  return schedulerEnabled(preferences)
    && (retryDue || (now.time >= (state.captureScheduleTime || preferences.captureTime)
      && state.lastCaptureDate !== now.date));
}

export function pushIsDue(preferences, state, now) {
  return schedulerEnabled(preferences)
    && now.time >= preferences.pushTime
    && state.lastPushDate !== now.date;
}
