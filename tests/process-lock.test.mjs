import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireProcessLock } from "../scripts/process-lock.mjs";

test("process lock blocks a live owner and releases only its own file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "caiguang-lock-"));
  const lock = path.join(directory, "daily-auto.lock");
  const release = acquireProcessLock(lock, { pid: 321, signal: () => {} });
  assert.equal((await readFile(lock, "utf8")).trim(), "321");
  assert.throws(() => acquireProcessLock(lock, { pid: 654, signal: () => {} }), /already|\u5df2\u6709/);
  release();
  const releaseAgain = acquireProcessLock(lock, { pid: 654, signal: () => {} });
  releaseAgain();
  await rm(directory, { recursive: true, force: true });
});

test("process lock recovers a stale owner", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "caiguang-lock-stale-"));
  const lock = path.join(directory, "daily-auto.lock");
  await writeFile(lock, "777\n");
  const release = acquireProcessLock(lock, { pid: 888, signal: () => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); } });
  assert.equal((await readFile(lock, "utf8")).trim(), "888");
  release();
  await rm(directory, { recursive: true, force: true });
});
