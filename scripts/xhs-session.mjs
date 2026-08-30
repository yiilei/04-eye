import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "vendor", "xhs-cli", ".venv", "bin", "xhs");
const appData = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const configDir = path.join(appData, "xhs-cli");
const command = process.argv[2] || "status";
if (!new Set(["login", "login-chrome", "status", "logout", "whoami"]).has(command)) throw new Error(`不支持的登录态命令：${command}`);

await mkdir(configDir, { recursive: true, mode: 0o700 });
const args = command === "login" ? ["login", "--qrcode"]
  : command === "login-chrome" ? ["login", "--browser"] : [command];
const child = spawn(executable, args, {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    XHS_CLI_CONFIG_DIR: configDir,
    XHS_CLI_DISABLE_BROWSER_COOKIE: command === "login-chrome" ? "0" : "1",
  },
});
child.on("exit", (code, signal) => {
  if (signal) console.error(`小红书登录助手被 ${signal} 中止`);
  process.exitCode = code ?? 1;
});
