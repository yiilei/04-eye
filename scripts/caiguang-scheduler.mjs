import { execFileSync, spawn, spawnSync } from "node:child_process";
import { access, chmod, cp, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
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
const localRuntimeRoot = path.join(appData, "runtime");
const localRuntimeNode = path.join(localRuntimeRoot, "node");
const localRuntimeRunner = path.join(localRuntimeRoot, "scheduler-runner.zsh");
const wakeLockPath = path.join(localRuntimeRoot, "caffeinate.pid");

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

async function stopWakeLock() {
  const pid = Number((await readFile(wakeLockPath, "utf8").catch(() => "")).trim());
  if (Number.isInteger(pid) && pid > 1) {
    const command = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).stdout?.trim() || "";
    if (command.startsWith("/usr/bin/caffeinate -s")) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already stopped */ }
    }
  }
  await rm(wakeLockPath, { force: true });
}

async function ensureWakeLock() {
  const pid = Number((await readFile(wakeLockPath, "utf8").catch(() => "")).trim());
  if (Number.isInteger(pid) && pid > 1) {
    try { process.kill(pid, 0); return; } catch { /* replace stale pid */ }
  }
  await mkdir(localRuntimeRoot, { recursive: true });
  const child = spawn("/usr/bin/caffeinate", ["-s"], { detached: true, stdio: "ignore" });
  child.unref();
  await writeFile(wakeLockPath, `${child.pid}\n`);
}

async function runCapture(reason = "scheduled") {
  await mkdir(logRoot, { recursive: true });
  const now = clock();
  const captureLog = path.join(logRoot, `${now.date}-capture.log`);
  const logHandle = await open(captureLog, "w");
  let status = 1;
  try {
    const child = spawn(wrapper, ["auto"], {
      cwd: projectRoot,
      env: { ...process.env, SHARP_EYE_HOME: appData },
      stdio: ["ignore", logHandle.fd, logHandle.fd],
    });
    status = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        resolve(124);
      }, 60 * 60 * 1000);
      child.once("error", () => { clearTimeout(timeout); resolve(1); });
      child.once("exit", (code) => { clearTimeout(timeout); resolve(code ?? 1); });
    });
  } finally {
    await logHandle.close();
  }
  const output = await readFile(captureLog, "utf8").catch(() => "");
  const ok = status === 0;
  const state = await readJson(statePath, {});
  state.lastCaptureAt = new Date().toISOString();
  state.lastCaptureStatus = ok ? "completed" : "needs_attention";
  state.lastCaptureReason = reason;
  if (ok) state.lastCaptureDate = now.date;
  await atomicJson(statePath, state);
  return { ok, output };
}

async function tick() {
  console.error("[scheduler] tick:start");
  await migrateLegacyData(appData);
  console.error("[scheduler] tick:migrated");
const preferences = await readJson(preferencesPath, { automaticCaptureEnabled: true, creatorH5CaptureEnabled: true, captureTime: "02:00", pushTime: "11:00" });
  if (!schedulerEnabled(preferences)) {
    await stopWakeLock();
    console.error("[scheduler] tick:disabled");
    return;
  }
  await ensureWakeLock();
  const state = await readJson(statePath, {});
  const now = clock();
  console.error(`[scheduler] tick:clock ${now.date} ${now.time}`);
  if (captureIsDue(preferences, state, now)) {
    console.error("[scheduler] tick:capture-due");
    await runCapture("scheduled");
    console.error("[scheduler] tick:capture-finished");
  }
  const latest = await readJson(statePath, state);
  if (pushIsDue(preferences, latest, now)) {
    const success = latest.lastCaptureDate === now.date && latest.lastCaptureStatus === "completed";
    notify("采光", success ? "今天的素材已经准备好，可以开始批阅。" : "今天的采集需要处理登录或页面异常。请打开采光查看。" );
    latest.lastPushDate = now.date;
    latest.lastPushAt = new Date().toISOString();
    await atomicJson(statePath, latest);
  }
  console.error("[scheduler] tick:done");
}

async function install() {
  await migrateLegacyData(appData);
  await mkdir(path.dirname(launchAgent), { recursive: true });
  await mkdir(logRoot, { recursive: true });
  await mkdir(localRuntimeRoot, { recursive: true });
  const appCandidates = [
    path.join(os.homedir(), "Applications", "采光.app", "Contents", "Resources", "runtime", "node"),
    path.join("/Applications", "采光.app", "Contents", "Resources", "runtime", "node"),
  ];
  let appExecutable = "";
  for (const candidate of appCandidates) {
    try { await access(candidate); appExecutable = candidate; break; } catch { /* try next */ }
  }
  if (!appExecutable) throw new Error("采光.app 缺少独立后台运行环境，请安装最新版采光");
  await rm(localRuntimeNode, { force: true });
  // launchd may stall before JavaScript starts when ProgramArguments points to
  // a symlink whose target lives inside an application bundle. Keep a private
  // executable copy in Application Support instead.
  await cp(appExecutable, localRuntimeNode);
  await chmod(localRuntimeNode, 0o755);
  // Runtime code is embedded in the signed app. Only the writable Node copy,
  // runner, logs and user state live in Application Support.
  const schedulerEntry = fileURLToPath(import.meta.url);
  await writeFile(localRuntimeRunner, [
    "#!/bin/zsh",
    `export HOME=${JSON.stringify(os.homedir())}`,
    "export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
    "export LANG=zh_CN.UTF-8",
    "export PYTHONDONTWRITEBYTECODE=1",
    `export SHARP_EYE_HOME=${JSON.stringify(appData)}`,
    `${JSON.stringify(localRuntimeNode)} ${JSON.stringify(schedulerEntry)} tick`,
    "exit $?",
    "",
  ].join("\n"));
  await chmod(localRuntimeRunner, 0o755);
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.yilei.caiguang.scheduler</string>
  <key>ProgramArguments</key><array>
    <string>/bin/zsh</string>
    <string>-f</string>
    <string>${xml(localRuntimeRunner)}</string>
  </array>
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
preferences: await readJson(preferencesPath, { automaticCaptureEnabled: true, creatorH5CaptureEnabled: true, captureTime: "02:00", pushTime: "11:00" }),
    state: await readJson(statePath, {}),
  }));
  if (result.status !== 0) process.exitCode = 1;
}

async function uninstall() {
  await stopWakeLock();
  spawnSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, launchAgent]);
  await rm(launchAgent, { force: true });
  console.log(JSON.stringify({ ok: true, removed: launchAgent }));
}

const command = process.argv[2] || "status";
if (command === "install") await install();
else if (command === "tick") await tick();
else if (command === "run") {
  const result = await runCapture("manual");
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
else if (command === "status") await status();
else if (command === "uninstall") await uninstall();
else throw new Error(`未知定时器命令：${command}`);

// Exit explicitly after all awaited writes. This also keeps scheduler ticks
// deterministic if a future dependency opens a background handle.
process.exit(process.exitCode || 0);
