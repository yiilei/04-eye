const transientBrowserPattern = /TargetClosedError|Target page, context or browser has been closed|ETIMEDOUT|timed out/u;

export function isTransientBrowserFailure(output) {
  return transientBrowserPattern.test(String(output || ""));
}

export function shouldRetryDiscovery(name, output, attempt = 1) {
  return attempt === 1
    && (name === "discover_creator_events" || name === "discover_pinned_accounts")
    && isTransientBrowserFailure(output);
}
