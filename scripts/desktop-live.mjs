import { spawn } from "node:child_process";
import process from "node:process";

const root = process.cwd();
const port = 3000;
const serverUrl = `http://localhost:${port}`;
const liveUrl = `${serverUrl}/?desktop=1`;
const children = new Set();

function run(command, args, env = {}) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, ...env } });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

function portIsOpen() {
  return fetch(serverUrl, { signal: AbortSignal.timeout(800) }).then(() => true).catch(() => false);
}

async function waitForApp() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await portIsOpen()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("本地页面没有在预期时间内启动");
}

const alreadyRunning = await portIsOpen();
if (!alreadyRunning) run("pnpm", ["dev"]);
await waitForApp();
const electron = run("pnpm", ["exec", "electron", "."], { CAIGUANG_DEV_URL: liveUrl });

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
electron.on("exit", (code) => { stop(); process.exitCode = code ?? 0; });
