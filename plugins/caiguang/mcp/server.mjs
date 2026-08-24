import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const projectRoot = path.resolve(pluginRoot, "../..");
const wrapper = path.join(pluginRoot, "scripts", "caiguang");
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const appData = path.join(dataHome, "data");
const workspaceData = path.join(projectRoot, "data");

const readJson = async (file, fallback) => {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
};

const writeJson = async (file, value) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
};

function run(command, args = [], timeout = 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, SHARP_EYE_HOME: dataHome },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("采光本地任务超时"));
    }, timeout);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      if (code === 0) resolve(output);
      else reject(new Error(output.split("\n").at(-1) || `采光任务退出：${code}`));
    });
  });
}

const response = (value) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  structuredContent: typeof value === "object" && value !== null ? value : { result: value },
});

const profileIdFromUrl = (url) => {
  const match = String(url).match(/\/user\/profile\/([a-zA-Z0-9]+)/);
  if (!match) throw new Error("请提供完整的小红书主页链接");
  return match[1];
};

const server = new McpServer({ name: "caiguang", version: "0.3.0" });

server.registerTool("caiguang_status", {
  title: "读取采光状态",
  description: "读取本机采光的定时设置、账号埋点、待验证数量、批阅素材数量和最近运行状态。",
  inputSchema: {},
}, async () => {
  const [preferences, scheduler, pins, pending, items] = await Promise.all([
    readJson(path.join(appData, "user-preferences.json"), {}),
    readJson(path.join(appData, "scheduler-state.json"), {}),
    readJson(path.join(workspaceData, "xhs-account-pins.json"), { accounts: [] }),
    readJson(path.join(appData, "xhs-pending-pins.json"), { accounts: [] }),
    readJson(path.join(appData, "generated-review-items.json"), []),
  ]);
  return response({ local: true, dataHome, preferences, scheduler, verifiedAccounts: pins.accounts?.filter((item) => item.status === "verified").length || 0,
    pendingAccounts: pending.accounts?.length || 0, reviewItems: items.length });
});

server.registerTool("caiguang_add_xhs_account", {
  title: "添加小红书埋点",
  description: "把小红书主页链接加入采光待验证队列。只按主页内部 ID 建立记录，不绑定相似名称账号。",
  inputSchema: { profileUrl: z.string().url().describe("完整的小红书主页链接") },
}, async ({ profileUrl }) => {
  const profileId = profileIdFromUrl(profileUrl);
  const file = path.join(appData, "xhs-pending-pins.json");
  const pending = await readJson(file, { schemaVersion: 1, updatedAt: "", accounts: [] });
  const exists = pending.accounts.some((item) => item.profileId === profileId || item.profileUrl === profileUrl);
  if (!exists) pending.accounts.push({ searchKey: profileId, profileId, profileUrl, status: "pending_verification", addedAt: new Date().toISOString() });
  pending.updatedAt = new Date().toISOString();
  await writeJson(file, pending);
  return response({ added: !exists, status: "pending_verification", profileId, profileUrl });
});

server.registerTool("caiguang_verify_accounts", {
  title: "验证待验证账号",
  description: "用采光本机已登录的小红书会话验证全部待验证主页；失败账号保持待验证，不自动换绑。",
  inputSchema: {},
}, async () => response(await run(wrapper, ["verify"])));

server.registerTool("caiguang_capture_post", {
  title: "抓取小红书帖子",
  description: "完整保存指定帖子中的图片、视频和 Live Photo 配对文件，并写入本地批阅页。",
  inputSchema: {
    url: z.string().url().describe("小红书帖子链接"),
    title: z.string().optional().describe("可选标题"),
    accountName: z.string().optional().describe("可选账号显示名称"),
    accountId: z.string().optional().describe("可选小红书号"),
  },
}, async ({ url, title = "", accountName = "", accountId = "" }) => {
  const args = ["capture", "--url", url];
  if (title) args.push("--title", title);
  if (accountName) args.push("--account-name", accountName);
  if (accountId) args.push("--account-id", accountId);
  return response(await run(wrapper, args));
});

server.registerTool("caiguang_run_daily", {
  title: "运行采光每日流程",
  description: "验证新埋点、发现账号和创作服务中心新增、下载普通帖子、校验素材并生成日报。",
  inputSchema: {},
}, async () => response(await run(wrapper, ["auto"])));

server.registerTool("caiguang_read_report", {
  title: "读取采光日报",
  description: "读取最新一份本地采光日报，包括新增素材与需要 Agent 处理的异常。",
  inputSchema: { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("可选日期 YYYY-MM-DD") },
}, async ({ date }) => {
  const selected = date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date());
  const report = await readFile(path.join(workspaceData, "reports", `${selected}-daily.md`), "utf8");
  return response(report);
});

server.registerTool("caiguang_open_review", {
  title: "打开采光批阅",
  description: "打开本机采光 App；不执行抓取或自动导入 Eagle。",
  inputSchema: {},
}, async () => {
  await run("/usr/bin/open", [path.join(os.homedir(), "Applications", "采光.app")], 30_000);
  return response({ opened: true, app: path.join(os.homedir(), "Applications", "采光.app") });
});

await server.connect(new StdioServerTransport());
