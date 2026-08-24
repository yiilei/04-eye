import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the local review shell without embedding private captures", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>采光<\/title>/);
  assert.match(html, /empty-review/);
  assert.match(html, /正在连接本地资料库/);
  assert.doesNotMatch(html, /招聘｜小红书REDesign招人啦|夏日电子梦/);
});

test("keeps the repository registry empty and starter material portable", async () => {
  const registry = JSON.parse(await readFile(new URL("../data/generated-review-items.json", import.meta.url), "utf8"));
  assert.deepEqual(registry, []);
  const starter = JSON.parse(await readFile(new URL("../starter/generated-review-items.json", import.meta.url), "utf8"));
  assert.deepEqual(starter.map((item) => item.id), [
    "kuaishou-small-budget-atmosphere-6a55aaf8",
    "starter-tanghulu-69af7a72",
  ]);
  assert.ok(starter.every((item) => item.localPath.startsWith("__USER_DATA__")));
});
