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

test("renders the latest captured account posts", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /招聘｜小红书REDesign招人啦/);
  assert.match(html, /运营设计｜build inspire love 82小红书日/);
  assert.match(html, /redesign-recruitment-6a7dc134\/01.webp/);
  assert.match(html, /营销设计｜超级开新26 视觉升级/);
  assert.match(html, /发现体｜一种生动的loop感/);
  assert.match(html, /夏日电子梦/);
  assert.match(html, /横版封面测试｜宽幅比例/);
  assert.doesNotMatch(html, /humanities-sing-opposite|beauty-auto-pipeline-test/);
});

test("registers the captured posts in newest-first order", async () => {
  const registry = JSON.parse(await readFile(new URL("../data/generated-review-items.json", import.meta.url), "utf8"));
  assert.deepEqual(registry.map((item) => item.postId), [
    "wide-cover-ui-demo",
    "summer-electronic-dream-20260814",
    "6a71caa40000000026036cab",
    "6a79719d000000003203315d",
    "6a7dc1340000000028003d7a",
    "6a7a9616000000002403f33f",
  ]);
  assert.match(registry[0].cover, /wide-cover-ui-demo\/01.png$/);
  assert.match(registry[1].image, /summer-electronic-dream-20260814\/full-page-hd.jpg$/);
  assert.match(registry[1].video, /summer-electronic-dream-20260814\/preview.mp4$/);
  assert.match(registry[2].cover, /douyin-ecommerce-discovery-loop-6a71caa4\/01.webp$/);
  assert.match(registry[2].video, /douyin-ecommerce-discovery-loop-6a71caa4\/video.mp4$/);
});
