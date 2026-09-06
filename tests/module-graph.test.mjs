import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { checkLocalModuleGraph } from "../scripts/check-local-module-graph.mjs";

test("packaging rejects a missing transitive native module", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "caiguang-modules-"));
  try {
    await mkdir(path.join(root, "desktop"));
    await writeFile(path.join(root, "desktop/main.mjs"), 'import "./server.mjs";');
    await writeFile(path.join(root, "desktop/server.mjs"), 'import { x } from "./policy.mjs";');
    await assert.rejects(checkLocalModuleGraph(root), /打包缺少模块/);
    await writeFile(path.join(root, "desktop/policy.mjs"), 'export const x = 1;');
    assert.equal(await checkLocalModuleGraph(root), 3);
  } finally { await rm(root, { recursive: true, force: true }); }
});
