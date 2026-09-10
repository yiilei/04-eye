import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupReviewedMedia, dateKeyInTimeZone } from "../scripts/review-cache-cleanup.mjs";

const exists = (filename) => access(filename).then(() => true).catch(() => false);

test("cleanup permanently removes reviewed bridge media but keeps pending media", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-cleanup-"));
  const keptFolder = path.join(dataHome, "review", "2026-09-01", "kept-item");
  const pendingFolder = path.join(dataHome, "review", "2026-09-01", "pending-item");
  const rejectedFolder = path.join(dataHome, "review", "2026-09-01", "rejected-item");
  const dataDir = path.join(dataHome, "data");
  await Promise.all([mkdir(keptFolder, { recursive: true }), mkdir(pendingFolder, { recursive: true }), mkdir(rejectedFolder, { recursive: true }), mkdir(dataDir, { recursive: true })]);
  await Promise.all([
    writeFile(path.join(keptFolder, "01.jpg"), "kept"),
    writeFile(path.join(pendingFolder, "01.jpg"), "pending"),
    writeFile(path.join(rejectedFolder, "01.jpg"), "rejected"),
    writeFile(path.join(dataDir, "generated-review-items.json"), JSON.stringify([
      { id: "kept", localPath: path.join(keptFolder, "01.jpg") },
      { id: "pending", localPath: path.join(pendingFolder, "01.jpg") },
      { id: "rejected", localPath: path.join(rejectedFolder, "01.jpg") },
    ])),
    writeFile(path.join(dataDir, "review-decisions.json"), JSON.stringify({ kept: { decision: "kept" }, rejected: { decision: "rejected" } })),
    writeFile(path.join(dataDir, "review-trash.json"), JSON.stringify({})),
  ]);

  const result = await cleanupReviewedMedia(dataHome);
  assert.deepEqual(result, { ok: true, removedKept: 1, purgedRejected: 1 });
  assert.equal(await exists(keptFolder), false);
  assert.equal(await exists(rejectedFolder), false);
  assert.equal(await exists(pendingFolder), true);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "generated-review-items.json"), "utf8")).map((item) => item.id), ["pending"]);
  const tombstone = JSON.parse(await readFile(path.join(dataDir, "review-trash.json"), "utf8")).rejected;
  assert.equal(tombstone.state, "purged");
  assert.equal(tombstone.recoverable, false);
  assert.equal(tombstone.reason, "撤回期已结束，文件已清理");
  await rm(dataHome, { recursive: true, force: true });
});

test("capture cleanup keeps today's decisions and removes only earlier Shanghai dates", async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), "caiguang-review-daily-cleanup-"));
  const dataDir = path.join(dataHome, "data");
  const makeMedia = async (id) => {
    const folder = path.join(dataHome, "review", "2026-09-10", id);
    const localPath = path.join(folder, "01.jpg");
    await mkdir(folder, { recursive: true });
    await writeFile(localPath, id);
    return { item: { id, localPath }, folder };
  };
  const [oldKept, oldRejected, todayKept, todayRejected, pending] = await Promise.all([
    makeMedia("old-kept"), makeMedia("old-rejected"), makeMedia("today-kept"),
    makeMedia("today-rejected"), makeMedia("pending"),
  ]);
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dataDir, "generated-review-items.json"), JSON.stringify([
      oldKept.item, oldRejected.item, todayKept.item, todayRejected.item, pending.item,
    ])),
    writeFile(path.join(dataDir, "review-decisions.json"), JSON.stringify({
      "old-kept": { decision: "kept", updatedAt: "2026-09-08T16:30:00.000Z" },
      "old-rejected": { decision: "rejected", updatedAt: "2026-09-08T16:30:00.000Z" },
      "today-kept": { decision: "kept", updatedAt: "2026-09-09T16:30:00.000Z" },
      "today-rejected": { decision: "rejected", updatedAt: "2026-09-09T16:30:00.000Z" },
    })),
    writeFile(path.join(dataDir, "review-trash.json"), "{}"),
  ]);

  const result = await cleanupReviewedMedia(dataHome, { beforeDate: "2026-09-10" });
  assert.deepEqual(result, { ok: true, removedKept: 1, purgedRejected: 1 });
  assert.equal(await exists(oldKept.folder), false);
  assert.equal(await exists(oldRejected.folder), false);
  assert.equal(await exists(todayKept.folder), true);
  assert.equal(await exists(todayRejected.folder), true);
  assert.equal(await exists(pending.folder), true);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(dataDir, "generated-review-items.json"), "utf8")).map((item) => item.id),
    ["today-kept", "today-rejected", "pending"],
  );
  assert.equal(dateKeyInTimeZone("2026-09-09T15:59:59.000Z"), "2026-09-09");
  assert.equal(dateKeyInTimeZone("2026-09-09T16:00:00.000Z"), "2026-09-10");
  await rm(dataHome, { recursive: true, force: true });
});
