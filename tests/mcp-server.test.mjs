import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("采光 MCP 可以启动、列出工具并读取本地状态", async () => {
  const transport = new StdioClientTransport({
    command: path.resolve("plugins/caiguang/scripts/mcp-launcher"),
    env: process.env,
  });
  const client = new Client({ name: "caiguang-test", version: "0.1.0" });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      "caiguang_add_xhs_account",
      "caiguang_capture_post",
      "caiguang_open_review",
      "caiguang_read_report",
      "caiguang_run_daily",
      "caiguang_status",
      "caiguang_verify_accounts",
    ].sort());
    const status = await client.callTool({ name: "caiguang_status", arguments: {} });
    assert.equal(status.isError, undefined);
    assert.match(status.content[0].text, /"local": true/);
  } finally {
    await client.close();
  }
});
