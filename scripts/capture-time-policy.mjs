const MINUTES_IN_CAPTURE_WINDOW = 9 * 60;

export function randomCaptureTime(random = Math.random) {
  const value = Number(random());
  const minuteOfDay = Math.min(MINUTES_IN_CAPTURE_WINDOW - 1, Math.max(0,
    Math.floor((Number.isFinite(value) ? value : 0) * MINUTES_IN_CAPTURE_WINDOW)));
  return `${String(Math.floor(minuteOfDay / 60)).padStart(2, "0")}:${String(minuteOfDay % 60).padStart(2, "0")}`;
}

export function initializeCapturePreferences(stored = {}, random = Math.random) {
  const preferences = { ...stored };
  const freshInstallation = Object.keys(stored).length === 0;
  let changed = false;
  if (freshInstallation) { preferences.onboardingComplete = false; changed = true; }
  if (preferences.automaticCaptureEnabled === undefined) { preferences.automaticCaptureEnabled = true; changed = true; }
  if (preferences.creatorH5CaptureEnabled === undefined) { preferences.creatorH5CaptureEnabled = true; changed = true; }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.captureTime || ""))) {
    // Preserve any explicitly configured valid time. Only a missing or
    // malformed value is randomized for a fresh installation.
    preferences.captureTime = randomCaptureTime(random);
    changed = true;
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(preferences.pushTime || ""))) { preferences.pushTime = "11:00"; changed = true; }
  return { preferences, changed };
}

export function ensureDailyCaptureSchedule(state = {}, date, random = Math.random) {
  if (state.captureScheduleDate === date && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(state.captureScheduleTime || ""))) {
    return { state, changed: false, time: state.captureScheduleTime };
  }
  const next = { ...state, captureScheduleDate: date, captureScheduleTime: randomCaptureTime(random) };
  return { state: next, changed: true, time: next.captureScheduleTime };
}
