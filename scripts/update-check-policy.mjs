const previousDate = (date) => new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export function updateCheckIsDue(status = {}, now, preferredTime = "20:00") {
  if (!now?.date || !now?.time) return false;
  if (status.lastSuccessfulCheckDate === now.date) return false;

  const attemptsToday = status.schedulerAttemptDate === now.date
    ? Math.max(0, Number(status.schedulerAttemptsToday || 0))
    : 0;
  if (attemptsToday > 0) {
    if (attemptsToday >= 2 || !status.schedulerNextAttemptAt) return false;
    return Date.parse(status.schedulerNextAttemptAt) <= (now.timestamp ?? Date.now());
  }

  if (now.time >= preferredTime) return true;
  const yesterday = previousDate(now.date);
  return Boolean(status.lastSuccessfulCheckDate && status.lastSuccessfulCheckDate < yesterday);
}
