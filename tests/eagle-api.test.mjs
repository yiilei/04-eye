import test from "node:test";
import assert from "node:assert/strict";
import { requestEagle } from "../desktop/eagle-api.mjs";

test("Eagle bridge only permits the five required local API routes", async () => {
  const blocked = await requestEagle({ path: "/library/info" }, async () => { throw new Error("must not run"); });
  assert.equal(blocked.status, 400);
  const traversal = await requestEagle({ path: "/folder/../library/info" }, async () => { throw new Error("must not run"); });
  assert.equal(traversal.status, 400);
});

test("Eagle bridge parses legacy API JSON without a token", async () => {
  let calledUrl = "";
  const result = await requestEagle({ path: "/application/info" }, async (url) => {
    calledUrl = url;
    return new Response(JSON.stringify({ status: "success", data: { version: "4.0.0" } }), { status: 200 });
  });
  assert.equal(calledUrl, "http://127.0.0.1:41595/api/application/info");
  assert.deepEqual(result.data, { status: "success", data: { version: "4.0.0" } });
});

test("Eagle bridge preserves authentication failures for a clear UI message", async () => {
  const result = await requestEagle({ path: "/folder/list" }, async () => new Response('{"message":"Unauthorized"}', { status: 401 }));
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
});
