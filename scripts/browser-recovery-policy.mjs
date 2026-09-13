const transientBrowserPattern = /TargetClosedError|Target page, context or browser has been closed|ETIMEDOUT|timed out/u;

export function isTransientBrowserFailure(output) {
  return transientBrowserPattern.test(String(output || ""));
}

export function shouldRetryDiscovery(name, output, attempt = 1) {
  return attempt === 1
    // Account discovery saves each completed account and has its own bounded
    // recovery list. Re-running the whole account batch duplicates work and
    // can turn two timeouts into an hour-long task.
    && name === "discover_creator_events"
    && isTransientBrowserFailure(output);
}
