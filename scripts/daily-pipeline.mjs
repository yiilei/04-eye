import { execFileSync } from "node:child_process";
import { open, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";

const root = process.cwd();
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const dataDir = path.join(root, "data");
const queuePath = path.join(dataDir, "xhs-capture-queue.json");
const pinsPath = path.join(dataDir, "xhs-account-pins.json");
const policyPath = path.join(dataDir, "xhs-media-policy.json");
const workspacePendingPinsPath = path.join(dataDir, "xhs-pending-pins.json");
const appPendingPinsPath = path.join(dataHome, "data", "xhs-pending-pins.json");
const registryPath = path.join(dataHome, "data", "generated-review-items.json");
const reportsDir = path.join(dataDir, "reports");
const lockPath = path.join(dataDir, "daily-pipeline.lock");
const dryRun = process.argv.includes("--dry-run");
const skipBuild = process.argv.includes("--skip-build");
const now = new Date();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
const nowIso = now.toISOString();

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const atomicJson = async (file, value) => {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const requireFields = (value, fields, label) => {
  for (const field of fields) if (!value[field]) throw new Error(`${label} 缺少 ${field}`);
};

function validateConfiguration(queue, pins, policy) {
  if (queue.schemaVersion !== 1 || !Array.isArray(queue.tasks) || !Array.isArray(queue.checkedAccounts)) throw new Error("抓取队列格式无效");
  if (pins.version !== 1 || !Array.isArray(pins.accounts)) throw new Error("账号埋点格式无效");
  if (policy.schemaVersion !== 1 || !policy.rules?.note_gallery || !policy.rules?.note_video || !policy.rules?.h5_event) throw new Error("素材策略格式无效");
  const seen = new Set();
  for (const account of pins.accounts) {
    requireFields(account, ["searchKey", "xiaohongshuId", "displayName", "group", "profileId", "profileUrl", "lastSeenPostId", "lastCheckedAt", "status"], `账号 ${account.displayName || account.searchKey}`);
    if (seen.has(account.searchKey)) throw new Error(`账号埋点重复：${account.searchKey}`);
    seen.add(account.searchKey);
  }
  for (const task of queue.tasks) {
    requireFields(task, ["id", "type", "status", "title", "slug", "sourceUrl"], `队列任务 ${task.id || "unknown"}`);
    if (!["note", "h5_event"].includes(task.type)) throw new Error(`不支持的队列类型：${task.type}`);
  }
}

function accountFor(pins, key) {
  return pins.accounts.find((account) => [account.searchKey, account.xiaohongshuId, account.profileId].includes(key));
}

function noteArguments(task, account) {
  const args = [path.join(root, "scripts", "xhs-capture.py"), "--url", task.sourceUrl, "--slug", task.slug,
    "--date", task.captureDate || today, "--account-name", account.displayName,
    "--account-id", account.xiaohongshuId, "--title", task.title];
  if (task.sourceDir) args.push("--source-dir", path.resolve(root, task.sourceDir));
  return args;
}

function h5Arguments(task) {
  const args = [path.join(root, "scripts", "capture-h5-event.mjs"),
    "--slug", task.slug, "--title", task.title, "--source-url", task.sourceUrl,
    "--date", task.captureDate || today, "--display-date", task.displayDate || task.captureDate || today];
  if (task.sourceDir) args.push("--source-dir", path.resolve(root, task.sourceDir));
  return args;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const queue = await readJson(queuePath);
  const pins = await readJson(pinsPath);
  const policy = await readJson(policyPath);
  const pendingPins = await readJson(appPendingPinsPath).catch(() => readJson(workspacePendingPinsPath).catch(() => ({ accounts: [] })));
  validateConfiguration(queue, pins, policy);
  const report = { schemaVersion: 1, date: today, startedAt: nowIso, mode: dryRun ? "dry-run" : "run",
    checkedAccounts: queue.checkedAccounts.length, pending: queue.tasks.filter((task) => task.status === "pending").length,
    h5AwaitingCapture: queue.tasks.filter((task) => task.status === "needs_h5_capture").length,
    pendingPinVerification: Array.isArray(pendingPins.accounts) ? pendingPins.accounts.filter((account) => account.status === "pending_verification").length : 0,
    completed: [], failed: [], skipped: [], validation: "not_run", build: "not_run" };

  if (!dryRun) {
    for (const task of queue.tasks.filter((item) => ["pending", "needs_h5_capture"].includes(item.status))) {
      try {
        if (task.type === "note") {
          const account = accountFor(pins, task.accountKey);
          if (!account || account.status !== "verified") throw new Error(`账号埋点不可用：${task.accountKey}`);
          const output = run(path.join(root, "vendor", "XHS-Downloader", ".venv", "bin", "python"), noteArguments(task, account));
          const result = JSON.parse(output.split("\n").at(-1));
          if (!result.ok) throw new Error(result.error || "帖子抓取失败");
          report.completed.push({ id: task.id, type: task.type, title: task.title, manifest: result.manifest, images: result.images, videos: result.videos, livePhotos: result.livePhotos });
        } else {
          const output = run(process.execPath, h5Arguments(task));
          const result = JSON.parse(output.split("\n").at(-1));
          if (!result.ok) throw new Error(result.error || "H5 登记失败");
          report.completed.push({ id: task.id, type: task.type, title: task.title, manifest: result.manifest, images: result.images, videos: result.videos });
        }
        task.status = "completed";
        task.completedAt = new Date().toISOString();
        delete task.error;
      } catch (error) {
        task.status = "failed";
        task.failedAt = new Date().toISOString();
        task.error = error instanceof Error ? error.message.split("\n").at(-1) : String(error);
        report.failed.push({ id: task.id, type: task.type, title: task.title, error: task.error });
      }
      await atomicJson(queuePath, queue);
    }

    for (const check of queue.checkedAccounts) {
      if (check.accountKey === "creator-events") {
        if (check.status !== "verified") report.failed.push({ id: "creator-events", type: "activity_check", title: "创作服务中心", error: check.error || `活动检查未完成：${check.status}` });
        continue;
      }
      const account = accountFor(pins, check.accountKey);
      if (!account) {
        report.failed.push({ id: check.accountKey, type: "account_check", title: check.accountKey, error: "账号埋点不存在" });
        continue;
      }
      const failedForAccount = queue.tasks.some((task) => task.accountKey === check.accountKey && task.status === "failed");
      if (check.status === "verified" && !failedForAccount) {
        if (check.latestPostId) account.lastSeenPostId = check.latestPostId;
        account.lastCheckedAt = check.checkedAt || new Date().toISOString();
        account.status = "verified";
      } else if (check.status === "pin_invalid") {
        account.status = "pin_invalid";
      } else if (check.status !== "verified") {
        report.failed.push({
          id: check.accountKey,
          type: "account_check",
          title: account.displayName,
          error: check.error || `账号检查未完成：${check.status}`,
        });
      }
    }
    pins.updatedAt = new Date().toISOString();
    await atomicJson(pinsPath, pins);


    try {
      run(process.execPath, [path.join(root, "scripts", "validate-review-manifest.mjs")]);
      report.validation = "passed";
    } catch (error) {
      report.validation = "failed";
      report.failed.push({ id: "validation", type: "pipeline", title: "素材校验", error: error instanceof Error ? error.message.split("\n").at(-1) : String(error) });
    }
    report.build = skipBuild ? "skipped" : "not_required_runtime_refresh";
  }

  report.finishedAt = new Date().toISOString();
  report.registryItems = await readJson(registryPath).then((items) => items.length).catch(() => 0);
  const reportBase = path.join(reportsDir, `${today}-daily`);
  await atomicJson(`${reportBase}.json`, report);
  const markdown = [`# ${today} 小红书视觉采集日报`, "",
    `- 检查账号：${report.checkedAccounts}`,
    `- 待处理任务：${report.pending}`,
    `- 待提取 H5：${report.h5AwaitingCapture}`,
    `- 待验证账号：${report.pendingPinVerification}`,
    `- 完成：${report.completed.length}`,
    `- 失败：${report.failed.length}`,
    `- 素材校验：${report.validation}`,
    `- 批阅页构建：${report.build}`,
    "", ...(report.completed.length ? ["## 新增", "", ...report.completed.map((item) => `- ${item.title}：${item.images || 0} 图 / ${item.videos || 0} 视频 / ${item.livePhotos || 0} Live Photo`)] : ["今日无新增"]),
    ...(report.pendingPinVerification ? ["", "## 今晚统一验证", "", `- ${report.pendingPinVerification} 个新账号等待身份核验；核验完成后才会进入日常抓取。`] : []),
    ...(report.failed.length ? ["", "## 需要 Codex 处理", "", ...report.failed.map((item) => `- ${item.title}：${item.error}`)] : []), ""].join("\n");
  await writeFile(`${reportBase}.md`, markdown);
  console.log(JSON.stringify({ ok: report.failed.length === 0, mode: report.mode, checkedAccounts: report.checkedAccounts,
    pending: report.pending, completed: report.completed.length, failed: report.failed.length,
    validation: report.validation, build: report.build, report: path.relative(root, `${reportBase}.md`) }));
  if (!dryRun && report.failed.length) process.exitCode = 1;
}

let lock;
try {
  lock = await open(lockPath, "wx");
  await main();
} catch (error) {
  if (error?.code === "EEXIST") console.error(JSON.stringify({ ok: false, error: "每日流水线已经在运行" }));
  else console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await lock?.close();
  if (lock) await unlink(lockPath).catch(() => {});
}
