import assert from "node:assert/strict";
import test from "node:test";
import { accountCapturePolicy, captureCandidates, diffPosts, isSafetyStopError, latestPostOnly, mergeDiscoveredTasks, normalizePosts, postIdTimestamp, profileIdentity, profileIdentityFromPosts, selectAccounts } from "../scripts/xhs-discover.mjs";

const account = { searchKey: "63044481856", xiaohongshuId: "63044481856" };

test("extracts verified profile identity", () => {
  assert.deepEqual(profileIdentity({ userPageData: { basicInfo: { nickname: "小红书REDesign", redId: "63044481856", userId: "profile" } } }), {
    displayName: "小红书REDesign", xiaohongshuId: "63044481856", profileId: "profile",
  });
});

test("extracts identity from xhs-cli root profile fallback", () => {
  assert.deepEqual(profileIdentity({ nickname: "小红书REDesign", redId: "63044481856", userId: "profile" }), {
    displayName: "小红书REDesign", xiaohongshuId: "63044481856", profileId: "profile",
  });
});

test("normalizes paginated xhs-cli cards with nested note IDs and tokens", () => {
  const payload = [[{
    id: "",
    xsecToken: "outer-token",
    noteCard: {
      noteId: "6a8bf4de0000000029018448",
      displayTitle: "「拼豆大赛设计」正是拼的年纪！",
      user: { nickName: "抖音电商设计", userId: "6606305e0000000003025553" },
    },
  }], [{
    id: "",
    noteCard: { noteId: "6a79719d000000003203315d", displayTitle: "营销设计", xsecToken: "nested-token" },
  }]];
  const posts = normalizePosts(payload, account);
  assert.deepEqual(posts.map((post) => post.id), ["6a8bf4de0000000029018448", "6a79719d000000003203315d"]);
  assert.equal(posts[0].token, "outer-token");
  assert.equal(posts[1].token, "nested-token");
  assert.match(posts[1].sourceUrl, /xsec_token=nested-token/);
});

test("extracts identity from nested xhs-cli user-posts payload", () => {
  const payload = [[{ id: "post", noteCard: { user: {
    nickName: "小红书REDesign", userId: "profile",
  } } }], [], []];
  assert.deepEqual(profileIdentityFromPosts(payload), {
    displayName: "小红书REDesign", xiaohongshuId: "", profileId: "profile",
  });
  assert.equal(normalizePosts(payload, account)[0].id, "post");
});

test("normalizes posts and preserves old-to-new enqueue order", () => {
  const posts = normalizePosts({ notes: [
    { id: "new-2", xsecToken: "b", noteCard: { displayTitle: "二" } },
    { id: "new-1", xsecToken: "a", noteCard: { displayTitle: "一" } },
    { id: "baseline", noteCard: { displayTitle: "旧" } },
  ] }, account);
  const result = diffPosts(posts, "baseline");
  assert.equal(result.status, "verified");
  assert.deepEqual(result.newPosts.map((post) => post.id), ["new-1", "new-2"]);
  assert.match(result.newPosts[0].sourceUrl, /xsec_token=a/);
});

test("stops instead of backfilling when baseline is missing", () => {
  assert.equal(diffPosts([{ id: "latest" }], "missing").status, "baseline_missing");
});

test("does not mistake older pinned posts for new posts", () => {
  const result = diffPosts([
    { id: "67cff174000000000603b551", pinned: true },
    { id: "6a75c0ad0000000028000492", pinned: true },
    { id: "6a7efc7000000000050213c7" },
  ], "6a7efc7000000000050213c7");
  assert.equal(result.status, "verified");
  assert.equal(result.newPosts.length, 0);
  assert.ok(postIdTimestamp("6a7efc7000000000050213c7") > postIdTimestamp("67cff174000000000603b551"));
});

test("keeps a newly published pinned post when it is newer than the baseline", () => {
  const result = diffPosts([
    { id: "6a9000020000000000000000", pinned: true },
    { id: "6a8000000000000000000000" },
  ], "6a8000000000000000000000");
  assert.deepEqual(result.newPosts.map((post) => post.id), ["6a9000020000000000000000"]);
});

test("first capture takes exactly the latest non-pinned post", () => {
  const result = latestPostOnly([
    { id: "6a9000030000000000000000", pinned: true },
    { id: "6a9000020000000000000000" },
    { id: "6a8000000000000000000000" },
  ]);
  assert.equal(result.status, "verified");
  assert.deepEqual(result.newPosts.map((post) => post.id), ["6a9000020000000000000000"]);
});

test("checks only accounts selected in the app while explicit checks still work", () => {
  const accounts = [
    { status: "verified", searchKey: "a", xiaohongshuId: "red-a", profileId: "profile-a" },
    { status: "verified", searchKey: "b", xiaohongshuId: "red-b", profileId: "profile-b" },
    { status: "pin_invalid", searchKey: "c", xiaohongshuId: "red-c", profileId: "profile-c" },
  ];
  assert.deepEqual(selectAccounts(accounts, [], ["profile-b"]).map((item) => item.searchKey), ["b"]);
  assert.deepEqual(selectAccounts(accounts, ["a"], []).map((item) => item.searchKey), ["a"]);
  assert.deepEqual(selectAccounts(accounts, [], []).map((item) => item.searchKey), []);
});

test("adapts account pacing as the enabled pin count grows", () => {
  assert.deepEqual(accountCapturePolicy(30), { tier: "standard", batchSize: 10, accountDelayMs: [5_000, 9_000], batchDelayMs: [60_000, 120_000] });
  assert.equal(accountCapturePolicy(31).tier, "cautious");
  assert.equal(accountCapturePolicy(60).batchSize, 10);
  assert.equal(accountCapturePolicy(61).tier, "conservative");
  assert.equal(accountCapturePolicy(100).batchSize, 8);
});

test("recognizes login and anti-abuse responses as safety-stop signals", () => {
  assert.equal(isSafetyStopError("HTTP 429 Too Many Requests"), true);
  assert.equal(isSafetyStopError("需要验证码，登录失效"), true);
  assert.equal(isSafetyStopError("普通图片解析失败"), false);
});

test("rediscovery refreshes token and releases a stranded task", () => {
  const existing = [{ id: "note-a", status: "needs_browser_capture", sourceUrl: "https://old", failureType: "parser_incompatible", error: "成功 0 个" }];
  const fresh = [{ id: "note-a", status: "pending", sourceUrl: "https://new?xsec_token=fresh", title: "new" }];
  const [task] = mergeDiscoveredTasks(existing, fresh);
  assert.equal(task.status, "pending");
  assert.equal(task.sourceUrl, fresh[0].sourceUrl);
  assert.equal(task.failureType, undefined);
  assert.equal(task.error, undefined);
});

test("rediscovery does not reopen completed work", () => {
  const completed = { id: "note-a", status: "completed", sourceUrl: "https://old" };
  assert.deepEqual(mergeDiscoveredTasks([completed], [{ id: "note-a", status: "pending", sourceUrl: "https://new" }]), [completed]);
});

test("visible stranded posts are refreshed even when they are not newly published", () => {
  const posts = [{ id: "old-failed", sourceUrl: "https://fresh" }, { id: "baseline" }];
  const tasks = [{ id: "note-old-failed", accountKey: "account", status: "needs_browser_capture" }];
  assert.deepEqual(captureCandidates(posts, [], tasks, "account"), [posts[0]]);
});
