import assert from "node:assert/strict";
import test from "node:test";
import { positionsForStableMedia, singleStateKey, stableMediaIdsForPositions } from "../scripts/review-ui-state.mjs";

test("single-save and single-remove state follows media identity after gallery reordering", () => {
  const original = { id: "post", gallery: ["https://cdn/a.jpg", "https://cdn/b.jpg"],
    galleryLocalPaths: ["/review/post/a.jpg", "/review/post/b.jpg"] };
  const reordered = { ...original, gallery: [original.gallery[1], original.gallery[0]],
    galleryLocalPaths: [original.galleryLocalPaths[1], original.galleryLocalPaths[0]] };
  const removedIds = stableMediaIdsForPositions(original, [0]);
  assert.deepEqual(removedIds, ["a.jpg"]);
  assert.deepEqual(positionsForStableMedia(reordered, removedIds), [1]);
  assert.equal(singleStateKey(original, 1), singleStateKey(reordered, 0));
});

test("whole-item import keys reuse the same stable file identity as single-save keys", () => {
  const item = { id: "post", gallery: ["https://cdn/a.jpg"], galleryLocalPaths: ["/review/post/a.jpg"] };
  assert.equal(`image-${stableMediaIdsForPositions(item, [0])[0]}`, "image-a.jpg");
  assert.equal(singleStateKey(item, 0), "post:a.jpg");
});
