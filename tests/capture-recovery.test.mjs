import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8");
const classify = new Function("results", "pipelineSummary", source.slice(source.indexOf("const failedStep ="), source.indexOf("let fallbackCount =")) + "return ok;");
test("pipeline occupied/error must not mark the day completed", () => {
  assert.equal(classify([], { ok: false, error: "每日流水线已经在运行" }), false);
  assert.equal(classify([], null), false);
  assert.equal(classify([], { ok: true, failed: 0, validation: "passed" }), true);
  assert.equal(classify([], { ok: false, failed: 1 }), false);
  assert.equal(classify([], { ok: false, browserCapture: 1, failed: 0, validation: "passed" }), false);
  assert.equal(classify([], { ok: false, retrying: 1, failed: 0, validation: "passed" }), false);
});
test("account failures are not hidden by a zero exit status", () => {
  assert.equal(classify([{ name: "discover_pinned_accounts", ok: true, summary: '{"ok":false}' }], { ok: true }), false);
});
test("X screenshot uses a defined request path", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /eagleJson/);
  assert.match(page, /AbortSignal\.timeout\(20_000\)/);
});
test("daily report describes browser recovery honestly", () => {
  const pipeline = readFileSync(new URL("../scripts/daily-pipeline.mjs", import.meta.url), "utf8");
  assert.match(pipeline, /等待浏览器兜底/);
  assert.doesNotMatch(pipeline, /MyFlicker 自动接管/);
  assert.match(pipeline, /完成前不会进入批阅或 Eagle/);
});
