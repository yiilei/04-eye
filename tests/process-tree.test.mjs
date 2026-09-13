import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { waitForManagedChild } from "../scripts/process-tree.mjs";

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const waitFor = async (predicate, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return false;
};

test("a managed timeout terminates the wrapper and its descendant process", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-process-tree-"));
  const childPidPath = path.join(temporary, "child.pid");
  const source = `const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e","process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:"ignore"});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
  const wrapper = spawn(process.execPath, ["-e", source, childPidPath], { detached: true, stdio: "ignore" });
  try {
    assert.equal(await waitFor(async () => Number(await readFile(childPidPath, "utf8").catch(() => "0")) > 1), true);
    const descendantPid = Number(await readFile(childPidPath, "utf8"));
    const result = await waitForManagedChild(wrapper, { timeoutMs: 80, graceMs: 80 });
    assert.equal(result.timedOut, true);
    assert.equal(await waitFor(() => !alive(wrapper.pid) && !alive(descendantPid)), true);
  } finally {
    try { process.kill(-wrapper.pid, "SIGKILL"); } catch { /* already gone */ }
    await rm(temporary, { recursive: true, force: true });
  }
});
