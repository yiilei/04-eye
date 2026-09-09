import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyH5Failure, clearH5Retry, h5TaskIsDue, MAX_H5_FAILURE_DAYS, transitionH5Failure } from "../scripts/h5-retry-policy.mjs";
import { isolatedXhsEnv } from "../scripts/xhs-runtime-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("H5 capture is isolated to the Caiguang session directory", () => {
  const dataHome = path.join(os.tmpdir(), "caiguang-session-test");
  const env = isolatedXhsEnv(dataHome, { PATH: "/usr/bin" });
  assert.equal(env.XHS_CLI_CONFIG_DIR, path.join(dataHome, "xhs-cli"));
  assert.equal(env.XHS_CLI_DISABLE_BROWSER_COOKIE, "1");
  assert.equal(env.NO_COLOR, "1");
});

test("H5 failures are checked at most once per calendar day and stop after three days", () => {
  const task = { type: "h5_event", status: "needs_h5_capture" };
  const firstAt = new Date("2026-08-24T02:00:00.000Z"); // 10:00 Shanghai
  const first = transitionH5Failure(task, "network timeout", firstAt);
  assert.equal(first.terminal, false);
  assert.equal(task.status, "deferred_next_day");
  assert.equal(h5TaskIsDue(task, firstAt), false);
  assert.equal(h5TaskIsDue(task, new Date("2026-08-25T02:00:00.000Z")), true);

  const second = transitionH5Failure(task, "timeout again", new Date("2026-08-25T02:00:00.000Z"));
  assert.equal(second.terminal, false);
  const third = transitionH5Failure(task, "third failure", new Date("2026-08-26T02:00:00.000Z"));
  assert.equal(third.failureDays, MAX_H5_FAILURE_DAYS);
  assert.equal(third.terminal, true);
  assert.equal(task.status, "manual_only");
  assert.equal(h5TaskIsDue(task, new Date("2026-08-27T02:00:00.000Z")), false);
  assert.equal(h5TaskIsDue(task, new Date("2026-08-27T02:00:00.000Z"), { manual: true }), true);

  clearH5Retry(task);
  assert.equal(task.attempts, undefined);
  assert.equal(task.nextAttemptAt, undefined);
});

test("H5 failures are classified before deciding whether to retry", () => {
  assert.equal(classifyH5Failure("detail_url_unresolved：正文尚未发布").category, "content_not_published");
  assert.equal(classifyH5Failure("network timeout").immediateRetry, true);
  assert.equal(classifyH5Failure("需要重新登录").category, "login_required");
  assert.equal(classifyH5Failure("HTTP 429 访问频繁").category, "risk_paused");
  assert.equal(classifyH5Failure("活动已下线，链接已失效").category, "unavailable");
});

test("unpublished H5 defers to tomorrow and becomes manual-only after three dates", () => {
  const task = { type: "h5_event", status: "needs_h5_capture" };
  const now = new Date("2026-08-31T02:00:00.000Z");
  transitionH5Failure(task, "活动正文尚未发布", now);
  assert.equal(task.status, "deferred_next_day");
  assert.equal(h5TaskIsDue(task, now), false);
  transitionH5Failure(task, "活动正文尚未发布", new Date("2026-09-01T02:00:00.000Z"));
  transitionH5Failure(task, "活动正文尚未发布", new Date("2026-09-02T02:00:00.000Z"));
  assert.equal(task.status, "content_not_published");
  assert.equal(task.nextEligibleDate, undefined);
});

test("same-day retries never consume another failure day or schedule a six-hour wake", () => {
  const task = { type: "h5_event", status: "needs_h5_capture" };
  transitionH5Failure(task, "network timeout", new Date("2026-09-08T02:00:00.000Z"));
  transitionH5Failure(task, "network timeout", new Date("2026-09-08T15:48:00.000Z"));
  assert.equal(task.failureDays, 1);
  assert.equal(task.nextEligibleDate, "2026-09-09");
  assert.equal(task.nextAttemptAt, undefined);
  assert.equal(h5TaskIsDue(task, new Date("2026-09-08T15:49:00.000Z")), false);
});

test("old six-hour fallback data is due tomorrow, never later on the same day", () => {
  const task = { type: "h5_event", status: "fallback_pending", lastAttemptAt: "2026-09-08T09:48:00.000Z",
    nextAttemptAt: "2026-09-08T15:48:00.000Z" };
  assert.equal(h5TaskIsDue(task, new Date("2026-09-08T15:48:00.000Z")), false);
  assert.equal(h5TaskIsDue(task, new Date("2026-09-09T02:00:00.000Z")), true);
});

test("authentication, verification, risk and dead links stop automatic retries", () => {
  for (const [message, status] of [
    ["登录已失效", "login_required"], ["请完成验证码 verification required", "verification_required"],
    ["HTTP 429 访问频繁", "risk_paused"], ["活动已下线，链接已失效", "unavailable"],
  ]) {
    const task = { type: "h5_event", status: "needs_h5_capture" };
    transitionH5Failure(task, message, new Date("2026-09-08T02:00:00.000Z"));
    assert.equal(task.status, status);
    assert.equal(h5TaskIsDue(task, new Date("2026-09-09T02:00:00.000Z")), false);
  }
});

test("the real daily pipeline defers an unresolved activity once without failing or repeating it", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-bounded-h5-"));
  const dataDir = path.join(temporary, "data");
  await mkdir(dataDir, { recursive: true });
  const task = { id: "h5-unresolved", type: "h5_event", status: "needs_h5_capture", accountKey: "creator-events",
    title: "正文未上线测试", slug: "xhs-event-unresolved", sourceUrl: "https://creator.xiaohongshu.com/new/events",
    captureDate: "2026-09-09", detailResolution: "unresolved", detailError: "未取得真实正文地址" };
  await writeFile(path.join(dataDir, "xhs-capture-queue.json"), `${JSON.stringify({ schemaVersion: 1,
    checkedAccounts: [{ accountKey: "creator-events", status: "verified" }], tasks: [task] })}\n`);
  await writeFile(path.join(dataDir, "xhs-account-pins.json"), `${JSON.stringify({ version: 1, accounts: [] })}\n`);
  await writeFile(path.join(dataDir, "xhs-pending-pins.json"), `${JSON.stringify({ accounts: [] })}\n`);
  await writeFile(path.join(dataDir, "generated-review-items.json"), "[]\n");
  await writeFile(path.join(dataDir, "xhs-media-policy.json"), await readFile(path.join(root, "data", "xhs-media-policy.json")));
  const runPipeline = () => spawnSync(process.execPath, [path.join(root, "scripts", "daily-pipeline.mjs"), "--skip-build"], {
    cwd: root, encoding: "utf8", env: { ...process.env, SHARP_EYE_HOME: temporary, CAIGUANG_CAPTURE_CREATOR_H5: "1" },
  });
  try {
    const first = runPipeline();
    assert.equal(first.status, 0, first.stderr);
    let queue = JSON.parse(await readFile(path.join(dataDir, "xhs-capture-queue.json"), "utf8"));
    assert.equal(queue.tasks[0].status, "deferred_next_day");
    assert.equal(queue.tasks[0].failureDays, 1);
    assert.equal(queue.tasks[0].nextAttemptAt, undefined);
    const firstAttemptAt = queue.tasks[0].lastAttemptAt;

    const second = runPipeline();
    assert.equal(second.status, 0, second.stderr);
    queue = JSON.parse(await readFile(path.join(dataDir, "xhs-capture-queue.json"), "utf8"));
    assert.equal(queue.tasks[0].failureDays, 1);
    assert.equal(queue.tasks[0].lastAttemptAt, firstAttemptAt, "same-day pipeline must skip the deferred item");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("completed capture status includes all H5 activities still waiting for publication", async () => {
  const source = await readFile(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8");
  assert.match(source, /"deferred_next_day"/);
  assert.match(source, /不会在今天反复访问/);
});

test("daily report distinguishes queued H5 work and unpublished fallbacks", async () => {
  const source = await readFile(new URL("../scripts/daily-pipeline.mjs", import.meta.url), "utf8");
  assert.match(source, /本轮 H5 任务/);
  assert.match(source, /活动正文获取失败（兜底记录）/);
  assert.match(source, /正式任务中只检查一次/);
  assert.match(source, /duplicateTitleCounts/);
});

test("rejected H5 evidence leaves no partial review directory", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "caiguang-h5-register-"));
  const source = path.join(temporary, "source");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "full-page-hd.jpg"), "not-used-before-evidence-check");
  await writeFile(path.join(source, "thumbnail.png"), "not-used-before-evidence-check");
  const slug = "missing-evidence";
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "register-h5-event.mjs"),
    "--source-dir", source, "--slug", slug, "--title", "fixture", "--source-url", "https://example.test/h5",
    "--date", "2026-08-24", "--display-date", "2026-08-24"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, SHARP_EYE_HOME: temporary },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /capture-result\.json/);
  await assert.rejects(access(path.join(temporary, "review", "2026-08-24", slug)));
  await rm(temporary, { recursive: true, force: true });
});

test("H5 capture rejects visible lazy-image placeholders and prefers rendered swiper art", async () => {
  const capture = await readFile(new URL("../scripts/xhs-h5-capture.py", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/capture-h5-event.mjs", import.meta.url), "utf8");
  assert.match(capture, /image\.naturalWidth <= 1/);
  assert.match(capture, /\.onix-image\[data-src\]/);
  assert.match(capture, /candidate\.srcset = source/);
  assert.match(capture, /const richest = slides\.sort/);
  assert.match(capture, /const contentWidth = appRect\.width/);
  assert.match(capture, /capture_stitched_page/);
  assert.match(capture, /fallback_reasons/);
  assert.doesNotMatch(capture, /fallback_reasons\.append\(f"\{preflight\['unloadedImages'\]\}/);
  assert.match(runner, /result\.brokenImages\?\.length/);
});

test("H5 stitched fallback is isolated as a plugin and only runs for risky pages", async () => {
  const plugin = await readFile(new URL("../plugins/h5-scroll-capture/capture.py", import.meta.url), "utf8");
  const setup = await readFile(new URL("../scripts/setup-downloader.sh", import.meta.url), "utf8");
  assert.match(plugin, /def capture_stitched_page/);
  assert.match(plugin, /page\.screenshot\(type="png"/);
  assert.match(plugin, /def _best_overlap/);
  assert.match(plugin, /分屏截图接缝无法可靠对齐/);
  assert.match(plugin, /animation-play-state: paused/);
  assert.match(plugin, /stitched\.save/);
  assert.match(setup, /h5-requirements\.txt/);
  assert.match(setup, /import camoufox, PIL, xhs_cli/);
  const requirements = await readFile(new URL("../scripts/h5-requirements.txt", import.meta.url), "utf8");
  assert.match(requirements, /Pillow>=11,<13/);
  const register = await readFile(new URL("../scripts/register-h5-event.mjs", import.meta.url), "utf8");
  assert.match(register, /captureMethod: captureEvidence\.captureMethod/);
});

test("installer is complete, cached, and keeps development dependencies optional", async () => {
  const setup = await readFile(path.join(root, "scripts", "setup-downloader.sh"), "utf8");
  assert.match(setup, /curl-cffi>=0\.15\.0/);
  assert.match(setup, /\.caiguang-setup/);
  assert.match(setup, /Camoufox 浏览器已缓存/);
  assert.match(setup, /engine_pid=\$!/);
  assert.match(setup, /python3\.12/);
  const wrapper = await readFile(path.join(root, "plugins", "caiguang", "scripts", "caiguang"), "utf8");
  assert.match(wrapper, /pnpm install --prod --frozen-lockfile --prefer-offline/);
  assert.match(wrapper, /setup-dev\)/);
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /electron: true/);
  const hosting = JSON.parse(await readFile(path.join(root, ".openai", "hosting.json"), "utf8"));
  assert.deepEqual(hosting, { d1: null, r2: null });
});
