import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const steps = [
  ["verify_pending_pins", [path.join(root, "scripts", "xhs-verify-pins.mjs"), "--write"]],
  ["discover_creator_events", [path.join(root, "scripts", "xhs-events-discover.mjs"), "--write"]],
  ["discover_pinned_accounts", [path.join(root, "scripts", "xhs-discover.mjs"), "--write"]],
  ["capture_validate_report", [path.join(root, "scripts", "daily-pipeline.mjs")]],
];

const results = [];
for (const [name, args] of steps) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 60 * 60 * 1000,
    env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  results.push({ name, ok: result.status === 0, status: result.status, output: output.split("\n").filter(Boolean).at(-1) || "" });
}
const ok = results.every((item) => item.ok);
console.log(JSON.stringify({ ok, results }));
if (!ok) process.exitCode = 1;
