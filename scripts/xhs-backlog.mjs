import { readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const queuePath = path.join(dataHome, "data", "xhs-capture-queue.json");
const queue = JSON.parse(await readFile(queuePath, "utf8"));
const command = process.argv.slice(2).find((value) => value !== "--") || "status";

if (command === "hold") {
  let changed = 0;
  for (const task of queue.tasks) {
    if (task.status !== "pending") continue;
    task.status = "backlog_held";
    task.heldAt = new Date().toISOString();
    task.holdReason = "用户选择暂不处理历史积压";
    changed += 1;
  }
  const temporary = `${queuePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(queue, null, 2)}\n`);
  await rename(temporary, queuePath);
  console.log(JSON.stringify({ ok: true, command, held: changed }));
} else if (command === "resume") {
  let changed = 0;
  for (const task of queue.tasks) {
    if (task.status !== "backlog_held") continue;
    task.status = "pending";
    delete task.heldAt;
    delete task.holdReason;
    changed += 1;
  }
  const temporary = `${queuePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(queue, null, 2)}\n`);
  await rename(temporary, queuePath);
  console.log(JSON.stringify({ ok: true, command, resumed: changed }));
} else if (command === "status") {
  const counts = Object.fromEntries([...new Set(queue.tasks.map((task) => task.status))]
    .map((status) => [status, queue.tasks.filter((task) => task.status === status).length]));
  console.log(JSON.stringify({ ok: true, command, counts }));
} else {
  throw new Error(`未知积压命令：${command}`);
}
