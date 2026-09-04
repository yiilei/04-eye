import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const dataDir = path.join(dataHome, "data");
const progressPath = path.join(dataHome, "data", "capture-progress.json");
const preferencesPath = path.join(dataHome, "data", "user-preferences.json");
const queuePath = path.join(dataDir, "xhs-capture-queue.json");
mkdirSync(dataDir, { recursive: true });
for (const name of ["xhs-account-pins.json", "xhs-media-policy.json", "xhs-capture-queue.json", "xhs-events-state.json", "xhs-pending-pins.json"]) {
  const target = path.join(dataDir, name);
  const seed = path.join(root, "data", name);
  if (!existsSync(target) && existsSync(seed)) copyFileSync(seed, target);
}
let creatorH5CaptureEnabled = true;
try {
  creatorH5CaptureEnabled = JSON.parse(readFileSync(preferencesPath, "utf8")).creatorH5CaptureEnabled === true;
} catch { /* fresh installs capture creator-center H5 by default */ }
const steps = [
  ["cleanup_reviewed_media", "清理已处理的本地中转素材", 6, [path.join(root, "scripts", "review-cache-cleanup.mjs")]],
  ["verify_pending_pins", "验证待验证账号", 12, [path.join(root, "scripts", "xhs-verify-pins.mjs"), "--write"]],
  ...(creatorH5CaptureEnabled
    ? [["discover_creator_events", "发现最新创作活动", 30, [path.join(root, "scripts", "xhs-events-discover.mjs"), "--write"]]]
    : []),
  ["discover_pinned_accounts", "检查埋点账号的新帖子", 52, [path.join(root, "scripts", "xhs-discover.mjs"), "--write"]],
  ["capture_validate_report", "抓取素材与文案并校验", 72, [path.join(root, "scripts", "daily-pipeline.mjs")]],
];

const startedAt = new Date().toISOString();
const writeProgress = (value) => {
  mkdirSync(path.dirname(progressPath), { recursive: true });
  const temporary = `${progressPath}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ startedAt, updatedAt: new Date().toISOString(), ...value }, null, 2)}\n`);
  renameSync(temporary, progressPath);
};

const results = [];
writeProgress({ state: "running", phase: "starting", label: "准备本地抓取", percent: 3, phaseIndex: 0, phaseCount: steps.length });
for (const [index, [name, label, percent, args]] of steps.entries()) {
  writeProgress({ state: "running", phase: name, label, percent, phaseIndex: index + 1, phaseCount: steps.length });
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60 * 60 * 1000,
    env: { ...process.env, CAIGUANG_CAPTURE_CREATOR_H5: creatorH5CaptureEnabled ? "1" : "0" }, stdio: ["ignore", "pipe", "pipe"] });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  results.push({ name, ok: result.status === 0, status: result.status, output,
    summary: output.split("\n").filter(Boolean).at(-1) || "" });
}
let pipelineSummary = null;
try {
  pipelineSummary = JSON.parse(results.find((item) => item.name === "capture_validate_report")?.summary || "null");
} catch { /* a genuinely malformed result remains a failure */ }
const failedStep = results.find((item) => !item.ok && item.name !== "capture_validate_report");
const pipelineHardFailure = !pipelineSummary
  || Number(pipelineSummary.failed || 0) > 0
  || pipelineSummary.validation === "failed";
// daily-pipeline intentionally exits non-zero while browser/retry fallbacks are
// pending. Those are recoverable hand-offs, not a failed capture run.
const ok = !failedStep && !pipelineHardFailure;
let fallbackCount = 0;
try {
  const queue = JSON.parse(readFileSync(queuePath, "utf8"));
  fallbackCount = queue.tasks.filter((task) => task.type === "h5_event" && task.status === "fallback_pending").length;
} catch {
  try { fallbackCount = Number(JSON.parse(results.find((item) => item.name === "capture_validate_report")?.summary || "{}").fallbacks || 0); } catch { /* status stays generic */ }
}
writeProgress(ok
  ? { state: "completed", phase: "completed", label: Number(pipelineSummary?.browserCapture || 0)
      ? `已抓取 ${pipelineSummary.completed || 0} 项，${pipelineSummary.browserCapture} 项等待浏览器兜底`
      : Number(pipelineSummary?.retrying || 0)
        ? `已抓取 ${pipelineSummary.completed || 0} 项，其余项目稍后自动重试`
        : fallbackCount ? `抓取完成，${fallbackCount} 项等待活动发布` : "抓取完成，批阅列表已刷新",
    percent: 100, phaseIndex: steps.length, phaseCount: steps.length, completedAt: new Date().toISOString() }
  : { state: "failed", phase: "failed", label: failedStep
      ? `${failedStep[1] || "前置步骤"}未完成，请查看日报`
      : Number(pipelineSummary?.failed || 0) > 0
        ? `${pipelineSummary.failed} 项抓取失败，请查看日报`
        : "抓取未完成，请查看日报",
    percent: Math.max(6, steps.find((step) => !results.find((result) => result.name === step[0])?.ok)?.[2] || 6), phaseIndex: results.length, phaseCount: steps.length, failedAt: new Date().toISOString() });
console.log(JSON.stringify({ ok, results }));
if (!ok) process.exitCode = 1;
