import assert from "node:assert/strict";
import test from "node:test";
import { eagleItemValidity, findTaggedEagleItem, nextEagleImportAction } from "../scripts/eagle-import-policy.mjs";

test("a detail verification outage propagates as uncertain rather than an absent item", async () => {
  const token = "caiguang:post:image-a";
  const fetchImpl = async () => ({ json: async () => ({ status: "success", data: [{ id: "existing", tags: [token] }] }) });
  await assert.rejects(findTaggedEagleItem(fetchImpl, "http://localhost/api", token, undefined,
    async () => { throw new Error("detail service unavailable"); }), /unavailable/);
});

test("exhausting the bounded search cannot authorize a duplicate import", async () => {
  let pages = 0;
  const fetchImpl = async () => {
    pages += 1;
    return { json: async () => ({ status: "success", data: Array.from({ length: 200 }, () => ({ tags: [] })) }) };
  };
  await assert.rejects(findTaggedEagleItem(fetchImpl, "http://localhost/api", "token", undefined, async () => true), /待确认/);
  assert.equal(pages, 20);
});

test("normal, partial, timed-out, closed, and trashed Eagle outcomes never become false success", async () => {
  assert.equal(eagleItemValidity({ id: "ok", isDeleted: false, width: 100, height: 80, size: 20 }, "ok", { width: 100, height: 80 }).valid, true);
  assert.equal(eagleItemValidity({ id: "partial", size: 0 }, "partial").valid, false);
  assert.equal(eagleItemValidity({ id: "trash", isDeleted: true, size: 20 }, "trash").reason, "deleted");
  assert.equal(nextEagleImportAction({ previousState: "uncertain", reconciliation: "found" }), "reuse");
  assert.equal(nextEagleImportAction({ previousState: "uncertain", reconciliation: "unavailable" }), "wait");
  assert.equal(nextEagleImportAction({ previousState: "completed", directValidity: { valid: false }, reconciliation: "missing" }), "import");
});

test("unique Eagle tag lookup paginates and ignores an item in the recycle bin", async () => {
  const token = "caiguang:post:image-a";
  const calls = [];
  const pageOne = Array.from({ length: 200 }, (_, index) => ({ id: `other-${index}`, tags: [] }));
  pageOne[0] = { id: "deleted", tags: [token] };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const offset = new URL(String(url)).searchParams.get("offset");
    return { json: async () => ({ status: "success", data: { items: offset === "0" ? pageOne : [{ id: "valid", tags: [token] }] } }) };
  };
  const found = await findTaggedEagleItem(fetchImpl, "http://127.0.0.1:41595/api", token, undefined,
    async (id) => id === "valid");
  assert.equal(found, "valid");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => new URL(url).searchParams.get("tags") === token));
});
