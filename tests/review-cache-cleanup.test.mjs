import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupReviewedMedia } from "../scripts/review-cache-cleanup.mjs";

const exists = (filename) => access(filename).then(() => true).catch(() => false);

test("cleanup permanently removes reviewed bridge media but keeps pending media", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-cleanup-"));
  const keptFolder = path.join(dataHome, "review", "2026-09-01", "kept-item");
  const pendingFolder = path.join(dataHome, "review", "2026-09-01", "pending-item");
  const rejectedFolder = path.join(dataHome, "trash", "rejected-item");
  const dataDir = path.join(dataHome, "data");
  await Promise.all([mkdir(keptFolder, { recursive: true }), mkdir(pendingFolder, { recursive: true }), mkdir(rejectedFolder, { recursive: true }), mkdir(dataDir, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(keptFolder, "01.jpg"), "kept"),
    writeFile(path.join(pendingFolder, "01.jpg"), "pending"),
    writeFile(path.join(rejectedFolder, "01.jpg"), "rejected"),
    writeFile(path.join(dataDir, "generated-review-items.json"), JSON.stringify([
      { id: "kept", localPath: path.join(keptFolder, "01.jpg") },
      { id: "pending", localPath: path.join(pendingFolder, "01.jpg") },
    ])),
    writeFile(path.join(dataDir, "review-decisions.json"), JSON.stringify({ kept: { decision: "kept" }, rejected: { decision: "rejected" } })),
    writeFile(path.join(dataDir, "review-trash.json"), JSON.stringify({ rejected: { trashFolder: rejectedFolder } })),
  ]);

  const result = await cleanupReviewedMedia(dataHome);
  assert.deepEqual(result, { ok: true, removedKept: 1, purgedRejected: 1 });
  assert.equal(await exists(keptFolder), false);
  assert.equal(await exists(rejectedFolder), false);
  assert.equal(await exists(pendingFolder), true);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "generated-review-items.json"), "utf8")).map((item) => item.id), ["pending"]);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "review-trash.json"), "utf8")), {});
  await rm(dataHome, { recursive: true, force: true });
});
