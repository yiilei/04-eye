import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { atomicJson, readJson, recoverReviewOperationUnlocked, withReviewStateLock } from "../scripts/review-state-store.mjs";

const exists = (filename) => access(filename).then(() => true).catch(() => false);

test("a corrupt or incomplete journal blocks later writes and remains intact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-corrupt-journal-"));
  const journal = path.join(root, "data", "review-operation.json");
  await mkdir(path.dirname(journal), { recursive: true });
  try {
    for (const raw of ['{', '{}', 'null']) {
      await writeFile(journal, raw);
      await assert.rejects(withReviewStateLock(root, async () => {
        await recoverReviewOperationUnlocked(root);
        await atomicJson(journal, { overwritten: true });
      }), /恢复日志/);
      assert.equal(await readFile(journal, 'utf8'), raw);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a killed real lock owner is reclaimed before the next write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-killed-owner-"));
  const moduleUrl = new URL('../scripts/review-state-store.mjs', import.meta.url).href;
  const code = `import {withReviewStateLock} from ${JSON.stringify(moduleUrl)}; await withReviewStateLock(${JSON.stringify(root)}, async()=>{ setInterval(()=>{},1000); console.log('locked'); await new Promise(()=>{}); });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(child.stdout, 'data');
    await assert.rejects(withReviewStateLock(root, async () => 'incorrect', {timeoutMs: 80}), /正在更新/);
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    assert.equal(await withReviewStateLock(root, async () => 'recovered', {timeoutMs: 200}), 'recovered');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
});

test("review state mutations are serialized across asynchronous writers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-lock-"));
  const statePath = path.join(root, "data", "state.json");
  await atomicJson(statePath, { values: [] });
  await Promise.all(Array.from({ length: 12 }, (_, value) => withReviewStateLock(root, async () => {
    const state = await readJson(statePath, { values: [] });
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.values.push(value);
    await atomicJson(statePath, state);
  })));
  const state = JSON.parse(await readFile(statePath, "utf8"));
  assert.deepEqual([...state.values].sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index));
  await rm(root, { recursive: true, force: true });
});

test("an interrupted NO operation is completed on recovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-recover-"));
  const data = path.join(root, "data");
  const originalFolder = path.join(root, "review", "2026-09-08", "item-1");
  const trashFolder = path.join(root, "trash", "item-1");
  const item = { id: "item-1", localPath: path.join(originalFolder, "01.jpg") };
  await mkdir(originalFolder, { recursive: true });
  await writeFile(item.localPath, "media");
  await atomicJson(path.join(data, "generated-review-items.json"), [item]);
  await atomicJson(path.join(data, "review-operation.json"), {
    type: "reject", id: item.id, item, itemIndex: 0, originalFolder, trashFolder,
    startedAt: "2026-09-08T01:00:00.000Z",
  });

  await withReviewStateLock(root, () => recoverReviewOperationUnlocked(root));
  assert.equal(await exists(originalFolder), false);
  assert.equal(await exists(trashFolder), true);
  assert.deepEqual(await readJson(path.join(data, "generated-review-items.json"), []), []);
  assert.equal((await readJson(path.join(data, "review-decisions.json"), {}))[item.id].decision, "rejected");
  assert.equal(await exists(path.join(data, "review-operation.json")), false);
  await rm(root, { recursive: true, force: true });
});

test("a lock owned by a dead process is reclaimed immediately", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-dead-lock-"));
  const lock = path.join(root, "data", "review-state.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, JSON.stringify({ pid: 2_147_483_647, createdAt: new Date().toISOString() }));
  const started = Date.now();
  const result = await withReviewStateLock(root, async () => "recovered", { timeoutMs: 250 });
  assert.equal(result, "recovered");
  assert.ok(Date.now() - started < 200, "dead PID lock should not wait for the stale timeout");
  await rm(root, { recursive: true, force: true });
});

test("a live lock is never stolen by a second writer", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-live-lock-"));
  let enteredSecond = false;
  await withReviewStateLock(root, async () => {
    await assert.rejects(
      withReviewStateLock(root, async () => { enteredSecond = true; }, { timeoutMs: 100 }),
      /批阅资料正在更新/,
    );
  });
  assert.equal(enteredSecond, false);
  await rm(root, { recursive: true, force: true });
});

test("an empty newly-created lock gets a grace period, then can be reclaimed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-lock-grace-"));
  const lock = path.join(root, "data", "review-state.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, "");
  await assert.rejects(withReviewStateLock(root, async () => undefined, { timeoutMs: 80 }), /批阅资料正在更新/);
  const old = new Date(Date.now() - 6_000);
  await utimes(lock, old, old);
  assert.equal(await withReviewStateLock(root, async () => "ok", { timeoutMs: 100 }), "ok");
  await rm(root, { recursive: true, force: true });
});

for (const phase of ["moved", "registry-updated", "decision-written"]) {
  test(`interrupted reject at ${phase} is recovered before later state can proceed`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), `caiguang-review-phase-${phase}-`));
    const data = path.join(root, "data");
    const originalFolder = path.join(root, "review", "2026-09-08", "first");
    const trashFolder = path.join(root, "trash", "first");
    const item = { id: "first", localPath: path.join(originalFolder, "01.jpg") };
    await mkdir(originalFolder, { recursive: true });
    await writeFile(item.localPath, "media");
    await atomicJson(path.join(data, "generated-review-items.json"), [item]);
    await atomicJson(path.join(data, "review-operation.json"), {
      type: "reject", id: item.id, item, itemIndex: 0, originalFolder, trashFolder,
      startedAt: "2026-09-08T01:00:00.000Z",
    });
    await mkdir(path.dirname(trashFolder), { recursive: true });
    await (await import("node:fs/promises")).rename(originalFolder, trashFolder);
    if (phase !== "moved") await atomicJson(path.join(data, "generated-review-items.json"), []);
    if (phase === "decision-written") await atomicJson(path.join(data, "review-decisions.json"), {
      first: { decision: "rejected", recoverable: true },
    });

    await withReviewStateLock(root, async () => {
      const recovered = await recoverReviewOperationUnlocked(root);
      assert.equal(recovered.recovered, true);
      // This represents the gate all later delete/register/cleanup mutations use.
      assert.equal(await exists(path.join(data, "review-operation.json")), false);
      await atomicJson(path.join(data, "later-write.json"), { allowed: true });
    });
    assert.equal((await readJson(path.join(data, "review-trash.json"), {})).first.recoverable, true);
    assert.deepEqual(await readJson(path.join(data, "generated-review-items.json"), []), []);
    assert.equal((await readJson(path.join(data, "later-write.json"), {})).allowed, true);
    await rm(root, { recursive: true, force: true });
  });
}

test("restore never recreates a normal item when both folders are missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-missing-"));
  const data = path.join(root, "data");
  const originalFolder = path.join(root, "review", "missing");
  const trashFolder = path.join(root, "trash", "missing");
  const item = { id: "missing", localPath: path.join(originalFolder, "01.jpg") };
  await atomicJson(path.join(data, "generated-review-items.json"), []);
  await atomicJson(path.join(data, "review-operation.json"), {
    type: "restore", id: item.id, item, itemIndex: 0, originalFolder, trashFolder,
    startedAt: "2026-09-08T01:00:00.000Z",
  });
  await withReviewStateLock(root, () => recoverReviewOperationUnlocked(root));
  assert.deepEqual(await readJson(path.join(data, "generated-review-items.json"), []), []);
  assert.equal((await readJson(path.join(data, "review-trash.json"), {})).missing.state, "missing");
  assert.equal((await readJson(path.join(data, "review-decisions.json"), {})).missing.recoverable, false);
  await rm(root, { recursive: true, force: true });
});
