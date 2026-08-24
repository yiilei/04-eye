import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { currentDataHome, migrateLegacyData } from "../desktop/data-migration.mjs";
import { captureIsDue, pushIsDue, schedulerEnabled } from "./scheduler-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appData = path.resolve(process.env.SHARP_EYE_HOME || currentDataHome);
const dataRoot = path.join(appData, "data");
const preferencesPath = path.join(dataRoot, "user-preferences.json");
const statePath = path.join(dataRoot, "scheduler-state.json");
const logRoot = path.join(appData, "logs");
const launchAgent = path.join(os.homedir(), "Library", "LaunchAgents", "com.yilei.caiguang.scheduler.plist");
const wrapper = path.join(projectRoot, "plugins", "caiguang", "scripts", "caiguang");

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
};
const atomicJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};
const xml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const clock = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

function notify(title, message) {
  spawnSync("/usr/bin/osascript", ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, message]);
}

async function runCapture(reason = "scheduled") {
  await mkdir(logRoot, { recursive: true });
  const now = clock();
  const result = spawnSync(wrapper, ["auto"], {
    cwd: projectRoot, encoding: "utf8", timeout: 60 * 60 * 1000,
    env: { ...process.env, SHARP_EYE_HOME: appData },
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  await writeFile(path.join(logRoot, `${now.date}-capture.log`), `${output}\n`);
  const ok = result.status === 0;
  const state = await readJson(statePath, {});
  state.lastCaptureDate = now.date;
  state.lastCaptureAt = new Date().toISOString();
  state.lastCaptureStatus = ok ? "completed" : "needs_attention";
  state.lastCaptureReason = reason;
  await atomicJson(statePath, state);
  return { ok, output };
}

async function tick() {
  await migrateLegacyData(appData);
  const preferences = await readJson(preferencesPath, { automaticCaptureEnabled: false, captureTime: "02:00", pushTime: "11:00" });
  if (!schedulerEnabled(preferences)) return;
  const state = await readJson(statePath, {});
  const now = clock();
  if (captureIsDue(preferences, state, now)) {
    await runCapture("scheduled");
  }
  const latest = await readJson(statePath, state);
  if (pushIsDue(preferences, latest, now)) {
    const success = latest.lastCaptureDate === now.date && latest.lastCaptureStatus === "completed";
    notify("采光", success ? "今天的素材已经准备好，可以开始批阅。" : "今天的采集需要处理登录或页面异常。请打开采光查看。" );
    latest.lastPushDate = now.date;
    latest.lastPushAt = new Date().toISOString();
    await atomicJson(statePath, latest);
  }
}

async function install() {
  await migrateLegacyData(appData);
  await mkdir(path.dirname(launchAgent), { recursive: true });
  await mkdir(logRoot, { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.yilei.caiguang.scheduler</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(fileURLToPath(import.meta.url))}</string>
    <string>tick</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>SHARP_EYE_HOME</key><string>${xml(appData)}</string></dict>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${xml(path.join(logRoot, "scheduler.stdout.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(path.join(logRoot, "scheduler.stderr.log"))}</string>
</dict></plist>\n`;
  await writeFile(launchAgent, plist, { mode: 0o600 });
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", domain, launchAgent]);
  execFileSync("/bin/launchctl", ["bootstrap", domain, launchAgent]);
  console.log(JSON.stringify({ ok: true, installed: launchAgent, preferences: preferencesPath }));
}

async function status() {
  const result = spawnSync("/bin/launchctl", ["print", `gui/${process.getuid()}/com.yilei.caiguang.scheduler`], { encoding: "utf8" });
  console.log(JSON.stringify({
    ok: result.status === 0,
    installed: result.status === 0,
    preferences: await readJson(preferencesPath, { automaticCaptureEnabled: false, captureTime: "02:00", pushTime: "11:00" }),
    state: await readJson(statePath, {}),
  }));
  if (result.status !== 0) process.exitCode = 1;
}

async function uninstall() {
  spawnSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, launchAgent]);
  await rm(launchAgent, { force: true });
  console.log(JSON.stringify({ ok: true, removed: launchAgent }));
}

const command = process.argv[2] || "status";
if (command === "install") await install();
else if (command === "tick") await tick();
else if (command === "run") console.log(JSON.stringify(await runCapture("manual")));
else if (command === "status") await status();
else if (command === "uninstall") await uninstall();
else throw new Error(`未知定时器命令：${command}`);
