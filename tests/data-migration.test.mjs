import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { migrateLegacyData } from "../desktop/data-migration.mjs";

test("migrates legacy media, login and paths without overwriting newer preferences", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-migration-"));
  const legacy = path.join(temporary, "04的眼");
  const current = path.join(temporary, "采光");
  await mkdir(path.join(legacy, "review", "day", "post"), { recursive: true });
  await mkdir(path.join(legacy, "xhs-cli"), { recursive: true });
  await mkdir(path.join(legacy, "data"), { recursive: true });
  await mkdir(path.join(current, "data"), { recursive: true });
  const oldMedia = path.join(legacy, "review", "day", "post", "01.webp");
  await writeFile(oldMedia, "media");
  await writeFile(path.join(legacy, "xhs-cli", "cookies.json"), "{}\n");
  await writeFile(path.join(legacy, "data", "generated-review-items.json"), JSON.stringify([{ id: "post", localPath: oldMedia }]));
  await writeFile(path.join(legacy, "data", "user-preferences.json"), JSON.stringify({ captureTime: "01:00", updatedAt: "2026-01-01" }));
  await writeFile(path.join(current, "data", "generated-review-items.json"), "[]\n");
  await writeFile(path.join(current, "data", "user-preferences.json"), JSON.stringify({ captureTime: "02:00", updatedAt: "2026-02-01" }));

  const result = await migrateLegacyData(current, legacy);
  assert.equal(result.registryItems, 1);
  const registry = JSON.parse(await readFile(path.join(current, "data", "generated-review-items.json"), "utf8"));
  assert.equal(registry[0].localPath, path.join(current, "review", "day", "post", "01.webp"));
  assert.equal(await readFile(path.join(current, "review", "day", "post", "01.webp"), "utf8"), "media");
  assert.equal(JSON.parse(await readFile(path.join(current, "data", "user-preferences.json"), "utf8")).captureTime, "02:00");
  assert.equal(await readFile(path.join(current, "xhs-cli", "cookies.json"), "utf8"), "{}\n");

  await writeFile(path.join(legacy, "data", "generated-review-items.json"), JSON.stringify([{ id: "late-old-item" }]));
  const second = await migrateLegacyData(current, legacy);
  assert.deepEqual(second, { migrated: false, reason: "already_migrated" });
  const unchanged = JSON.parse(await readFile(path.join(current, "data", "generated-review-items.json"), "utf8"));
  assert.equal(unchanged.some((item) => item.id === "late-old-item"), false);
});
