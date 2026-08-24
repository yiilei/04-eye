export function schedulerEnabled(preferences) {
  return preferences?.automaticCaptureEnabled === true;
}

export function captureIsDue(preferences, state, now) {
  return schedulerEnabled(preferences)
    && now.time === preferences.captureTime
    && state.lastCaptureDate !== now.date;
}

export function pushIsDue(preferences, state, now) {
  return schedulerEnabled(preferences)
    && now.time === preferences.pushTime
    && state.lastPushDate !== now.date;
}
