import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clearH5Retry, h5FailureIsPermanent, h5TaskIsDue, MAX_H5_ATTEMPTS, scheduleH5PublicationRetry, scheduleH5Retry } from "../scripts/h5-retry-policy.mjs";
import { isolatedXhsEnv } from "../scripts/xhs-runtime-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("H5 capture is isolated to the Caiguang session directory", () => {
  const dataHome = path.join(os.tmpdir(), "caiguang-session-test");
  const env = isolatedXhsEnv(dataHome, { PATH: "/usr/bin" });
  assert.equal(env.XHS_CLI_CONFIG_DIR, path.join(dataHome, "xhs-cli"));
  assert.equal(env.XHS_CLI_DISABLE_BROWSER_COOKIE, "1");
  assert.equal(env.NO_COLOR, "1");
});

test("H5 transient failures retry twice before becoming terminal", () => {
  const task = { type: "h5_event", status: "needs_h5_capture" };
  const firstAt = new Date("2026-08-24T02:00:00.000Z");
  const first = scheduleH5Retry(task, "timeout", firstAt);
  assert.equal(first.terminal, false);
  assert.equal(task.status, "retry_pending");
  assert.equal(h5TaskIsDue(task, firstAt), false);
  assert.equal(h5TaskIsDue(task, new Date(first.nextAttemptAt)), true);

  const second = scheduleH5Retry(task, "timeout again", new Date(first.nextAttemptAt));
  assert.equal(second.terminal, false);
  const third = scheduleH5Retry(task, "third failure", new Date(second.nextAttemptAt));
  assert.equal(third.attempts, MAX_H5_ATTEMPTS);
  assert.equal(third.terminal, true);
  assert.equal(task.status, "failed");

  clearH5Retry(task);
  assert.equal(task.attempts, undefined);
  assert.equal(task.nextAttemptAt, undefined);
});

test("unpublished H5 is permanent while network timeouts remain retryable", () => {
  assert.equal(h5FailureIsPermanent("创作服务中心已展示活动，但活动 H5 尚未发布或链接已失效"), true);
  assert.equal(h5FailureIsPermanent("network timeout"), false);
});

test("unpublished H5 keeps a low-frequency retry after fallback registration", () => {
  const task = { type: "h5_event", status: "needs_h5_capture" };
  const now = new Date("2026-08-31T02:00:00.000Z");
  const retry = scheduleH5PublicationRetry(task, "活动尚未发布", now);
  assert.equal(task.status, "fallback_pending");
  assert.equal(h5TaskIsDue(task, now), false);
  assert.equal(h5TaskIsDue(task, new Date(retry.nextAttemptAt)), true);
});

test("completed capture status includes all H5 activities still waiting for publication", async () => {
  const source = await readFile(new URL("../scripts/daily-auto.mjs", import.meta.url), "utf8");
  assert.match(source, /task\.type === "h5_event" && task\.status === "fallback_pending"/);
  assert.match(source, /抓取完成，\$\{fallbackCount\} 项等待活动发布/);
});

test("daily report distinguishes queued H5 work and unpublished fallbacks", async () => {
  const source = await readFile(new URL("../scripts/daily-pipeline.mjs", import.meta.url), "utf8");
  assert.match(source, /本轮 H5 任务/);
  assert.match(source, /活动尚未上线（兜底记录）/);
  assert.match(source, /下一次定时抓取或手动抓取时继续尝试/);
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
  assert.match(setup, /Pillow>=11,<13/);
  const register = await readFile(new URL("../scripts/register-h5-event.mjs", import.meta.url), "utf8");
  assert.match(register, /captureMethod: captureEvidence\.captureMethod/);
});

test("installer is complete, cached, and keeps development dependencies optional", async () => {
  const setup = await readFile(path.join(root, "scripts", "setup-downloader.sh"), "utf8");
  assert.match(setup, /curl-cffi>=0\.15\.0/);
  assert.match(setup, /\.caiguang-setup/);
  assert.match(setup, /Camoufox 浏览器已缓存/);
  assert.match(setup, /engine_pid=\$!/);
  const wrapper = await readFile(path.join(root, "plugins", "caiguang", "scripts", "caiguang"), "utf8");
  assert.match(wrapper, /pnpm install --prod --frozen-lockfile --prefer-offline/);
  assert.match(wrapper, /setup-dev\)/);
  const workspace = await readFile(path.join(root, "pnpm-workspace.yaml"), "utf8");
  assert.match(workspace, /electron: true/);
  const hosting = JSON.parse(await readFile(path.join(root, ".openai", "hosting.json"), "utf8"));
  assert.deepEqual(hosting, { d1: null, r2: null });
});
