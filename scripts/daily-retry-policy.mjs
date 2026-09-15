const cleanupPhase = "cleanup_reviewed_media";
const finalPhase = "capture_validate_report";

// A manual continuation resumes only the failed discovery/verification phase,
// then processes the material it produced. Unknown legacy failures keep the
// full-flow fallback so upgrades can still recover old progress files.
export function selectDailyRetrySteps(steps, retryRequested, retryPhases) {
  if (!retryRequested) return steps;
  const byName = new Map(steps.map((step) => [step[0], step]));
  const requested = (Array.isArray(retryPhases) ? retryPhases : [retryPhases]).filter((name) => byName.has(name));
  if (!requested.length) return steps;
  const requestedSet = new Set([cleanupPhase, ...requested, finalPhase]);
  return steps.filter((step) => requestedSet.has(step[0]));
}
