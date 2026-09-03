import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isolatedXhsEnv } from "./xhs-runtime-env.mjs";

const root = process.cwd();
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const raw = process.argv.slice(2).filter((value) => value !== "--");
const args = new Map();
for (let index = 0; index < raw.length; index += 2) args.set(raw[index], raw[index + 1]);
const required = (key) => {
  const value = args.get(key);
  if (!value) throw new Error(`缺少参数 ${key}`);
  return value;
};
const date = args.get("--date") || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
const slug = required("--slug");
let sourceDir = args.get("--source-dir");

if (!sourceDir) {
  sourceDir = path.join(dataHome, "data", "h5-staging", date, slug);
  await mkdir(sourceDir, { recursive: true });
  const python = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "python");
  const output = execFileSync(python, [path.join(root, "scripts", "xhs-h5-capture.py"),
    "--source-url", required("--source-url"), "--output-dir", sourceDir],
  {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: isolatedXhsEnv(dataHome),
  }).trim();
  const result = JSON.parse(output.split("\n").at(-1));
  if (!result.ok) throw new Error(result.status || "H5 主体抓取失败");
  if (!result.excludedRecommendations) throw new Error("未识别到底部推荐流边界，禁止进入批阅页");
  if (result.dynamicCandidates > 0 && !result.animation) throw new Error("检测到动态资源但原始动画下载失败，禁止标记为无动效");
}

const forwarded = ["--source-dir", path.resolve(sourceDir), "--slug", slug,
  "--title", required("--title"), "--source-url", required("--source-url"),
  "--date", date, "--display-date", args.get("--display-date") || date];
const output = execFileSync(process.execPath, [path.join(root, "scripts", "register-h5-event.mjs"), ...forwarded],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
console.log(output.split("\n").at(-1));
