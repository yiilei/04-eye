import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { clearH5Retry, h5TaskIsDue, MAX_H5_ATTEMPTS, scheduleH5Retry } from "../scripts/h5-retry-policy.mjs";
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

test("installer is complete, cached, and keeps development dependencies optional", async () => {
  const setup = await readFile(path.join(root, "scripts", "setup-downloader.sh"), "utf8");
  assert.match(setup, /curl-cffi>=0\.15\.0/);
  assert.match(setup, /\.caiguang-setup/);
  assert.match(setup, /Camoufox 浏览器已缓存/);
  assert.match(setup, /engine_pid=\$!/);
  const wrapper = await readFile(path.join(root, "plugins", "caiguang", "scripts", "caiguang"), "utf8");
  assert.match(wrapper, /pnpm install --prod --frozen-lockfile --prefer-offline/);
  assert.match(wrapper, /setup-dev\)/);
  const packagedInstaller = await readFile(path.join(root, "packaging", "开始安装.command"), "utf8");
  assert.match(packagedInstaller, /pnpm install --prod --frozen-lockfile --prefer-offline/);
  const hosting = JSON.parse(await readFile(path.join(root, ".openai", "hosting.json"), "utf8"));
  assert.deepEqual(hosting, { d1: null, r2: null });
});
