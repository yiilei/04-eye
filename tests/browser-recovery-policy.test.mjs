import test from "node:test";
import assert from "node:assert/strict";
import { isTransientBrowserFailure, shouldRetryDiscovery } from "../scripts/browser-recovery-policy.mjs";

test("closed browser and startup timeout are retryable", () => {
  assert.equal(isTransientBrowserFailure("playwright TargetClosedError"), true);
  assert.equal(isTransientBrowserFailure("spawnSync python ETIMEDOUT"), true);
  assert.equal(isTransientBrowserFailure("request timed out"), true);
});

test("only creator discovery retries its whole step once", () => {
  assert.equal(shouldRetryDiscovery("discover_creator_events", "ETIMEDOUT"), true);
  assert.equal(shouldRetryDiscovery("discover_pinned_accounts", "TargetClosedError"), false);
  assert.equal(shouldRetryDiscovery("capture_validate_report", "ETIMEDOUT"), false);
  assert.equal(shouldRetryDiscovery("discover_creator_events", "ETIMEDOUT", 2), false);
});
