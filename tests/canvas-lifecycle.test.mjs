import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canvas input follows the mounted viewer node", async () => {
  const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(source, /ref=\{setViewerNode\}/);
  assert.match(source, /\[usesTallScroll, viewerElement\]/);
  assert.match(source, /\[viewerElement\]/);
  assert.doesNotMatch(source, /ref=\{viewer\}/);
});
