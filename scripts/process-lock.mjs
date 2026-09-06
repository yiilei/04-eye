import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const occupiedError = () => Object.assign(new Error("已有抓取任务正在运行"), { code: "EEXIST" });

export function acquireProcessLock(lockPath, { pid = process.pid, signal = (owner) => process.kill(owner, 0) } = {}) {
  mkdirSync(path.dirname(lockPath), { recursive: true });
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = openSync(lockPath, "wx");
      writeFileSync(handle, `${pid}\n`);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let owner = 0;
      try { owner = Number(readFileSync(lockPath, "utf8").trim()); } catch { /* replaced concurrently; retry below */ }
      try {
        if (Number.isInteger(owner) && owner > 1) signal(owner);
        throw occupiedError();
      } catch (ownerError) {
        if (ownerError?.code === "EPERM") throw occupiedError();
        if (ownerError?.code !== "ESRCH") throw ownerError;
      }
      try { unlinkSync(lockPath); } catch (unlinkError) { if (unlinkError?.code !== "ENOENT") throw unlinkError; }
    }
  }
  if (handle === undefined) throw occupiedError();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { closeSync(handle); } catch { /* already closed */ }
    try {
      const owner = Number(readFileSync(lockPath, "utf8").trim());
      if (owner === pid) unlinkSync(lockPath);
    } catch { /* already removed or replaced */ }
  };
}
