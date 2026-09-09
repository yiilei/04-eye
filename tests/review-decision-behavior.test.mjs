import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startDesktopServer } from "../desktop/server.mjs";
import { atomicJson, readJson } from "../scripts/review-state-store.mjs";
import { cleanupReviewedMedia } from "../scripts/review-cache-cleanup.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exists = (filename) => access(filename).then(() => true).catch(() => false);

async function createItem(root, id) {
  const folder = path.join(root, "review", "2026-09-08", id);
  const localPath = path.join(folder, "01.jpg");
  await mkdir(folder, { recursive: true });
  await writeFile(localPath, `media-${id}`);
  return { id, title: id, localPath, galleryLocalPaths: [localPath] };
}

async function post(base, id, decision) {
  return fetch(new URL("/api/desktop/review-decision", base), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, decision }),
  });
}

test("NO can be undone immediately, but cleanup produces an explicit non-recoverable response", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-decision-http-"));
  const item = await createItem(root, "undo-item");
  await atomicJson(path.join(root, "data", "generated-review-items.json"), [item]);
  const desktop = await startDesktopServer(projectRoot, root);
  try {
    assert.equal((await post(desktop.url, item.id, "rejected")).status, 200);
    assert.equal(await exists(item.localPath), true);
    assert.equal((await readJson(path.join(root, "data", "generated-review-items.json"), [])).some((value) => value.id === item.id), true);
    const restored = await post(desktop.url, item.id, "pending");
    assert.equal(restored.status, 200);
    assert.equal(await exists(item.localPath), true);
    assert.equal((await readJson(path.join(root, "data", "generated-review-items.json"), [])).some((value) => value.id === item.id), true);

    assert.equal((await post(desktop.url, item.id, "rejected")).status, 200);
    await cleanupReviewedMedia(root);
    const expired = await post(desktop.url, item.id, "pending");
    assert.equal(expired.status, 410);
    const body = await expired.json();
    assert.equal(body.unrecoverable, true);
    assert.match(body.error, /撤回期已结束|文件已清理/);
    assert.equal(await exists(item.localPath), false);
    assert.equal((await readJson(path.join(root, "data", "generated-review-items.json"), [])).some((value) => value.id === item.id), false);
  } finally {
    desktop.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a later delete first recovers the previously interrupted journal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-decision-recovery-http-"));
  await atomicJson(path.join(root, "data", "generated-review-items.json"), []);
  const desktop = await startDesktopServer(projectRoot, root);
  try {
    const first = await createItem(root, "first");
    const second = await createItem(root, "second");
    await atomicJson(path.join(root, "data", "generated-review-items.json"), [first, second]);
    const firstOriginal = path.dirname(first.localPath);
    const firstTrash = path.join(root, "trash", "interrupted-first");
    await atomicJson(path.join(root, "data", "review-operation.json"), {
      type: "reject", id: first.id, item: first, itemIndex: 0,
      originalFolder: firstOriginal, trashFolder: firstTrash, startedAt: new Date().toISOString(),
    });
    await mkdir(path.dirname(firstTrash), { recursive: true });
    await rename(firstOriginal, firstTrash);

    const response = await post(desktop.url, second.id, "rejected");
    assert.equal(response.status, 200);
    const registry = await readJson(path.join(root, "data", "generated-review-items.json"), []);
    const trash = await readJson(path.join(root, "data", "review-trash.json"), {});
    assert.equal(registry.some((item) => item.id === first.id), false);
    assert.equal(registry.some((item) => item.id === second.id), true);
    assert.equal(trash.first.recoverable, true);
    assert.equal(trash.second, undefined);
    assert.equal((await readJson(path.join(root, "data", "review-decisions.json"), {})).second.cleanupState, "pending_cleanup");
    assert.equal(await exists(path.join(root, "data", "review-operation.json")), false);
  } finally {
    desktop.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("review UI migration cannot overwrite initialized app-library state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-ui-http-"));
  await atomicJson(path.join(root, "data", "generated-review-items.json"), []);
  const desktop = await startDesktopServer(projectRoot, root);
  try {
    const endpoint = new URL("/api/desktop/review-ui-state", desktop.url);
    const first = { savedSingles: { "post:a.jpg": "eagle-1" }, removedSingles: { post: ["b.jpg"] },
      dismissedIds: ["group"], unavailableUndo: {} };
    assert.equal((await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: first, migration: true }) })).status, 200);
    assert.equal((await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: { savedSingles: {}, removedSingles: {}, dismissedIds: [] }, migration: true }) })).status, 200);
    const stored = JSON.parse(await readFile(path.join(root, "data", "review-ui-state.json"), "utf8"));
    assert.equal(stored.savedSingles["post:a.jpg"], "eagle-1");
    assert.deepEqual(stored.removedSingles.post, ["b.jpg"]);
  } finally {
    desktop.close();
    await rm(root, { recursive: true, force: true });
  }
});
