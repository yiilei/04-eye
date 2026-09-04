import { execFileSync } from "node:child_process";
import { open, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { clearH5Retry, h5FailureIsPermanent, h5TaskIsDue, scheduleH5PublicationRetry, scheduleH5Retry } from "./h5-retry-policy.mjs";
import { clearNoteFailure, noteTaskIsDue, transitionNoteFailure } from "./note-capture-policy.mjs";

const root = process.cwd();
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const dataDir = path.join(dataHome, "data");
const queuePath = path.join(dataDir, "xhs-capture-queue.json");
const pinsPath = path.join(dataDir, "xhs-account-pins.json");
const policyPath = path.join(dataDir, "xhs-media-policy.json");
const appPendingPinsPath = path.join(dataHome, "data", "xhs-pending-pins.json");
const registryPath = path.join(dataHome, "data", "generated-review-items.json");
const reportsDir = path.join(dataDir, "reports");
const diagnosticsDir = path.join(dataHome, "logs", "xhs");
const lockPath = path.join(dataDir, "daily-pipeline.lock");
const dryRun = process.argv.includes("--dry-run");
const skipBuild = process.argv.includes("--skip-build");
const now = new Date();
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
const nowIso = now.toISOString();
const creatorH5CaptureEnabled = process.env.CAIGUANG_CAPTURE_CREATOR_H5 === "1";

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const atomicJson = async (file, value) => {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};
const run = (command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const captureErrorMessage = (error) => {
  const chunks = [error?.stdout, error?.stderr, error instanceof Error ? error.message : String(error)]
    .map((value) => String(value || "").trim()).filter(Boolean);
  const lines = chunks.flatMap((chunk) => chunk.split("\n")).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.error || parsed.status) return parsed.error || parsed.status;
    } catch { /* keep looking for a structured child-process error */ }
  }
  const explicitError = lines.find((line) => /^(?:Error|[A-Za-z]+Error):\s+/.test(line));
  if (explicitError) return explicitError.replace(/^(?:Error|[A-Za-z]+Error):\s+/, "");
  const raw = chunks[0] || "未知抓取错误";
  return raw.split("\n").map((line) => line.trim()).filter((line) => !/^Node\.js v\d+/.test(line)).at(-1) || raw;
};
const captureDiagnostics = (error) => [error?.stdout, error?.stderr, error instanceof Error ? error.stack || error.message : String(error)]
  .map((value) => String(value || "").trim()).filter(Boolean).join("\n\n");
const safeTaskId = (value) => String(value || "task").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 100);
const writeCaptureDiagnostics = async (task, error) => {
  await mkdir(diagnosticsDir, { recursive: true });
  const attempt = Number(task.attempts || 0) + 1;
  const filename = `${today}-${safeTaskId(task.id)}-attempt-${attempt}.log`;
  const target = path.join(diagnosticsDir, filename);
  await writeFile(target, `${captureDiagnostics(error)}\n`);
  return target;
};
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

function h5FallbackArguments(task, error) {
  const args = [path.join(root, "scripts", "register-h5-fallback.mjs"),
    "--slug", task.slug, "--title", task.title, "--source-url", task.sourceUrl,
    "--date", task.captureDate || today, "--display-date", task.displayDate || task.captureDate || today,
    "--error", error];
  if (task.coverUrl) args.push("--cover-url", task.coverUrl);
  if (task.sourceDir) args.push("--source-dir", path.resolve(root, task.sourceDir));
  return args;
}

async function main() {
  await mkdir(reportsDir, { recursive: true });
  const queue = await readJson(queuePath);
  const pins = await readJson(pinsPath);
  const policy = await readJson(policyPath);
  const pendingPins = await readJson(appPendingPinsPath).catch(() => ({ accounts: [] }));
  validateConfiguration(queue, pins, policy);
  const browserCaptureTasks = queue.tasks.filter((task) => task.status === "needs_browser_capture");
  const report = { schemaVersion: 1, date: today, startedAt: nowIso, mode: dryRun ? "dry-run" : "run",
    checkedAccounts: queue.checkedAccounts.length, pending: queue.tasks.filter((task) => task.status === "pending").length,
    h5AwaitingCapture: creatorH5CaptureEnabled
      ? queue.tasks.filter((task) => task.status === "needs_h5_capture").length
      : 0,
    pendingPinVerification: Array.isArray(pendingPins.accounts) ? pendingPins.accounts.filter((account) => account.status === "pending_verification").length : 0,
    completed: [], retrying: [], fallbacks: [], browserCapture: browserCaptureTasks.map((task) => ({
      id: task.id, type: task.type, title: task.title, error: task.error || task.lastError || "本地解析器不可用", failureType: task.failureType || "parser_incompatible",
    })), failed: [], skipped: [], validation: "not_run", build: "not_run" };

  if (!dryRun) {
    for (const task of queue.tasks.filter((item) => item.type === "h5_event"
      ? creatorH5CaptureEnabled && h5TaskIsDue(item, now)
      : noteTaskIsDue(item, now))) {
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
        if (task.type === "h5_event") clearH5Retry(task);
        else clearNoteFailure(task);
      } catch (error) {
        const message = captureErrorMessage(error);
        const diagnostics = captureDiagnostics(error);
        const diagnosticsPath = task.type === "note" ? await writeCaptureDiagnostics(task, error) : undefined;
        if (task.type === "h5_event") {
          const permanentFailure = h5FailureIsPermanent(message);
          if (permanentFailure) {
            const retry = scheduleH5PublicationRetry(task, message, now);
            try {
              const output = run(process.execPath, h5FallbackArguments(task, message));
              const fallback = JSON.parse(output.split("\n").at(-1));
              report.fallbacks.push({ id: task.id, type: task.type, title: task.title, error: message,
                fallback: fallback.ok ? fallback.manifest : null, attempts: retry.attempts, nextAttemptAt: retry.nextAttemptAt });
            } catch (fallbackError) {
              const fallbackMessage = captureErrorMessage(fallbackError);
              report.failed.push({ id: task.id, type: task.type, title: task.title,
                error: `${message}；生成失败兜底也失败：${fallbackMessage}` });
            }
            await atomicJson(queuePath, queue);
            continue;
          }
          const retry = scheduleH5Retry(task, message, now);
          const entry = { id: task.id, type: task.type, title: task.title, error: message, attempts: retry.attempts };
          if (retry.terminal) {
            try {
              const output = run(process.execPath, h5FallbackArguments(task, message));
              const fallback = JSON.parse(output.split("\n").at(-1));
              report.failed.push({ ...entry, fallback: fallback.ok ? fallback.manifest : null,
                error: `${message}；已保留封面与原链接，可在批阅页打开体验` });
            } catch (fallbackError) {
              const fallbackMessage = fallbackError instanceof Error ? fallbackError.message.split("\n").at(-1) : String(fallbackError);
              report.failed.push({ ...entry, error: `${message}；生成失败兜底也失败：${fallbackMessage}` });
            }
          }
          else report.retrying.push({ ...entry, nextAttemptAt: retry.nextAttemptAt });
        } else {
          const transition = transitionNoteFailure(task, diagnostics || message, now);
          task.diagnosticsPath = diagnosticsPath;
          const entry = { id: task.id, type: task.type, title: task.title, error: message,
            failureType: transition.category, diagnosticsPath };
          if (transition.action === "browser_capture") {
            if (!report.browserCapture.some((item) => item.id === task.id)) report.browserCapture.push(entry);
          } else if (transition.action === "retry") report.retrying.push({ ...entry, attempts: transition.attempts, nextAttemptAt: transition.nextAttemptAt });
          else report.failed.push(entry);
        }
      }
      await atomicJson(queuePath, queue);
    }

    for (const check of queue.checkedAccounts) {
      if (check.accountKey === "creator-events") {
        if (!creatorH5CaptureEnabled) continue;
        if (check.status !== "verified") report.failed.push({ id: "creator-events", type: "activity_check", title: "创作服务中心", error: check.error || `活动检查未完成：${check.status}` });
        continue;
      }
      const account = accountFor(pins, check.accountKey);
      if (!account) {
        report.failed.push({ id: check.accountKey, type: "account_check", title: check.accountKey, error: "账号埋点不存在" });
        continue;
      }
      const unfinishedForAccount = queue.tasks.some((task) => task.accountKey === check.accountKey && task.status !== "completed");
      if (check.status === "verified" && !unfinishedForAccount) {
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

  report.pending = queue.tasks.filter((task) => ["pending", "needs_h5_capture", "retry_pending", "fallback_pending", "needs_browser_capture"].includes(task.status)).length;
  report.finishedAt = new Date().toISOString();
  report.registryItems = await readJson(registryPath).then((items) => items.length).catch(() => 0);
  const duplicateTitleCounts = report.completed.reduce((counts, item) => {
    counts.set(item.title, (counts.get(item.title) || 0) + 1);
    return counts;
  }, new Map());
  const reportTitle = (item) => duplicateTitleCounts.get(item.title) > 1
    ? `${item.title}（活动 ${String(item.id).replace(/^h5-/, "").slice(-6)}）`
    : item.title;
  const localTime = (value) => value
    ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value))
    : "下一次运行";
  const reportBase = path.join(reportsDir, `${today}-daily`);
  await atomicJson(`${reportBase}.json`, report);
  const markdown = [`# ${today} 小红书视觉采集日报`, "",
    `- 检查账号：${report.checkedAccounts}`,
    `- 待处理任务：${report.pending}`,
    `- 本轮 H5 任务：${report.h5AwaitingCapture}`,
    `- 等待活动上线：${report.fallbacks.length}`,
    `- 待验证账号：${report.pendingPinVerification}`,
    `- 完成：${report.completed.length}`,
    `- 失败：${report.failed.length}`,
    `- 素材校验：${report.validation}`,
    `- 批阅页构建：${report.build}`,
    "", ...(report.completed.length ? ["## 新增", "", ...report.completed.map((item) => `- ${reportTitle(item)}：${item.images || 0} 图 / ${item.videos || 0} 视频 / ${item.livePhotos || 0} Live Photo`)] : ["今日无新增"]),
    ...(report.pendingPinVerification ? ["", "## 今晚统一验证", "", `- ${report.pendingPinVerification} 个新账号等待身份核验；核验完成后才会进入日常抓取。`] : []),
    ...(report.retrying.length ? ["", "## 自动重试", "", ...report.retrying.map((item) => `- ${item.title}：第 ${item.attempts} 次失败，将在 ${item.nextAttemptAt} 后自动重试`)] : []),
    ...(report.fallbacks.length ? ["", "## 活动尚未上线（兜底记录）", "", ...report.fallbacks.map((item) => `- ${item.title}：${item.error}。已保留封面、失败原因和创作服务中心入口；当前不是完整素材，不会导入 Eagle。已尝试 ${item.attempts} 次，${localTime(item.nextAttemptAt)} 起具备重试资格，将在下一次定时抓取或手动抓取时继续尝试。`)] : []),
    ...(report.browserCapture.length ? ["", "## MyFlicker 自动接管", "", ...report.browserCapture.map((item) => `- ${item.title}：${item.failureType}，需从已授权页面提取完整媒体清单`)] : []),
    ...(report.failed.length ? ["", "## 需要用户处理", "", ...report.failed.map((item) => `- ${item.title}：${item.error}`)] : []), ""].join("\n");
  await writeFile(`${reportBase}.md`, markdown);
  const ok = report.failed.length === 0 && report.browserCapture.length === 0 && report.retrying.length === 0;
  console.log(JSON.stringify({ ok, mode: report.mode, checkedAccounts: report.checkedAccounts,
    pending: report.pending, completed: report.completed.length, fallbacks: report.fallbacks.length, browserCapture: report.browserCapture.length, failed: report.failed.length,
    retrying: report.retrying.length, nextRetryAt: report.retrying.map((item) => item.nextAttemptAt).filter(Boolean).sort()[0] || null,
    validation: report.validation, build: report.build, report: path.relative(root, `${reportBase}.md`) }));
  if (!dryRun && !ok) process.exitCode = 1;
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
