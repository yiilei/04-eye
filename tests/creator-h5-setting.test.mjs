import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dailyAuto = await readFile(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8");
const pipeline = await readFile(new URL("../scripts/daily-pipeline.mjs", import.meta.url), "utf8");
const server = await readFile(new URL("../desktop/server.mjs", import.meta.url), "utf8");
const capturePreferences = await readFile(new URL("../scripts/capture-time-policy.mjs", import.meta.url), "utf8");

test("creator H5 capture defaults on and gates discovery and retries", () => {
  assert.match(server, /initializeCapturePreferences/);
  assert.match(capturePreferences, /preferences\.creatorH5CaptureEnabled === undefined\).*preferences\.creatorH5CaptureEnabled = true/);
  assert.match(dailyAuto, /creatorH5CaptureEnabled === true/);
  assert.match(dailyAuto, /\?\s*\[\["discover_creator_events"/);
  assert.match(pipeline, /creatorH5CaptureEnabled && h5TaskIsDue/);
  assert.match(pipeline, /if \(!creatorH5CaptureEnabled\) continue/);
});
