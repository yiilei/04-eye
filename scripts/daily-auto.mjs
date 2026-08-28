import { spawnSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const progressPath = path.join(dataHome, "data", "capture-progress.json");
const steps = [
  ["verify_pending_pins", "验证待验证账号", 12, [path.join(root, "scripts", "xhs-verify-pins.mjs"), "--write"]],
  ["discover_creator_events", "发现最新创作活动", 30, [path.join(root, "scripts", "xhs-events-discover.mjs"), "--write"]],
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
    env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  results.push({ name, ok: result.status === 0, status: result.status, output: output.split("\n").filter(Boolean).at(-1) || "" });
}
const ok = results.every((item) => item.ok);
writeProgress(ok
  ? { state: "completed", phase: "completed", label: "抓取完成，批阅列表已刷新", percent: 100, phaseIndex: steps.length, phaseCount: steps.length, completedAt: new Date().toISOString() }
  : { state: "failed", phase: "failed", label: "抓取失败：小红书账号主页加载异常", percent: Math.max(6, steps.find((step) => !results.find((result) => result.name === step[0])?.ok)?.[2] || 6), phaseIndex: results.length, phaseCount: steps.length, failedAt: new Date().toISOString() });
console.log(JSON.stringify({ ok, results }));
if (!ok) process.exitCode = 1;
