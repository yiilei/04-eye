import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { seedStarterData } from "../desktop/starter-data.mjs";

test("seeds the portable Tanghulu and Kuaishou review items on first launch", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "caiguang-starter-"));
  const reviewRoot = path.join(dataRoot, "review");
  const registryPath = path.join(dataRoot, "data", "generated-review-items.json");
  await mkdir(path.dirname(registryPath), { recursive: true });
  await mkdir(reviewRoot, { recursive: true });

  const result = await seedStarterData(process.cwd(), dataRoot, registryPath, reviewRoot);
  assert.deepEqual(result, { seeded: true, items: 2 });
  const items = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.id), [
    "kuaishou-small-budget-atmosphere-6a55aaf8",
    "starter-tanghulu-69af7a72",
  ]);
  assert.ok(items.every((item) => item.galleryLocalPaths.every((file) => file.startsWith(dataRoot))));
  await stat(path.join(reviewRoot, "2026-08-24", "kuaishou-small-budget-atmosphere-6a55aaf8", "live-07.mp4"));
  await stat(path.join(reviewRoot, "2026-08-24", "starter-tanghulu-69af7a72", "live-05.mp4"));

  const second = await seedStarterData(process.cwd(), dataRoot, registryPath, reviewRoot);
  assert.deepEqual(second, { seeded: false, reason: "already_seeded" });
});

test("repairs a pre-existing empty registry once, then preserves a deliberately empty library", async () => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "caiguang-starter-empty-"));
  const reviewRoot = path.join(dataRoot, "review");
  const registryPath = path.join(dataRoot, "data", "generated-review-items.json");
  await mkdir(path.dirname(registryPath), { recursive: true });
  await mkdir(reviewRoot, { recursive: true });
  await writeFile(registryPath, "[]\n");

  const repaired = await seedStarterData(process.cwd(), dataRoot, registryPath, reviewRoot);
  assert.deepEqual(repaired, { seeded: true, items: 2 });
  await writeFile(registryPath, "[]\n");
  const afterUserClear = await seedStarterData(process.cwd(), dataRoot, registryPath, reviewRoot);
  assert.deepEqual(afterUserClear, { seeded: false, reason: "already_seeded" });
});
