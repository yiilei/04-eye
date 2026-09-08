import assert from "node:assert/strict";
import test from "node:test";
import { schedulerInstallationIsCurrent } from "../scripts/scheduler-install-policy.mjs";

const current = {
  loaded: true,
  runnerSource: '\"/data/runtime/node\" \"/Applications/采光.app/Contents/Resources/runtime/project/scripts/caiguang-scheduler.mjs\" tick',
  plistSource: "/data/runtime/scheduler-runner.zsh /data/logs/scheduler.stdout.log /data/logs/scheduler.stderr.log",
  schedulerEntry: "/Applications/采光.app/Contents/Resources/runtime/project/scripts/caiguang-scheduler.mjs",
  runtimeNode: "/data/runtime/node",
  localRuntimeRunner: "/data/runtime/scheduler-runner.zsh",
  stdoutPath: "/data/logs/scheduler.stdout.log",
  stderrPath: "/data/logs/scheduler.stderr.log",
  runtimeNodeExists: true,
};

test("a loaded scheduler with a stale temporary plist is reinstalled", () => {
  assert.equal(schedulerInstallationIsCurrent({
    ...current,
    plistSource: "/private/tmp/package-qa/runtime/scheduler-runner.zsh /private/tmp/package-qa/logs/stderr.log",
  }), false);
});

test("only a fully current and runnable scheduler can skip installation", () => {
  assert.equal(schedulerInstallationIsCurrent(current), true);
  assert.equal(schedulerInstallationIsCurrent({ ...current, runtimeNodeExists: false }), false);
  assert.equal(schedulerInstallationIsCurrent({ ...current, runnerSource: "" }), false);
});
