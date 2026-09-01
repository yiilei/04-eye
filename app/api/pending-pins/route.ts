import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const runtimeRoot = process.env.CAIGUANG_SOURCE_ROOT || process.env.INIT_CWD || process.env.PWD || process.cwd();
const pendingPath = path.join(runtimeRoot, "data", "xhs-pending-pins.json");

type PendingPin = {
  searchKey: string;
  xiaohongshuId: string;
  displayName: string;
  group: string;
  profileId: string;
  profileUrl: string;
  status: string;
  addedAt?: string;
  lastVerificationAttemptAt?: string;
  verificationError?: string;
};

async function readPending() {
  try {
    return JSON.parse(await readFile(pendingPath, "utf8")) as { schemaVersion: number; updatedAt: string | null; accounts: PendingPin[] };
  } catch {
    return { schemaVersion: 1, updatedAt: null, accounts: [] as PendingPin[] };
  }
}

async function writePending(accounts: PendingPin[]) {
  await mkdir(path.dirname(pendingPath), { recursive: true });
  const temporary = `${pendingPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), accounts }, null, 2)}\n`);
  await rename(temporary, pendingPath);
}

export async function GET() {
  return Response.json(await readPending(), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const payload = await request.json() as { accounts?: PendingPin[] };
  if (!Array.isArray(payload.accounts)) return Response.json({ ok: false, error: "invalid accounts" }, { status: 400 });
  const accounts = payload.accounts.filter((account) =>
    account && typeof account.profileId === "string"
    && /^https:\/\/www\.xiaohongshu\.com\/user\/profile\/[a-zA-Z0-9_-]+$/.test(account.profileUrl)
    && account.status === "pending_verification");
  await writePending(accounts);
  return Response.json({ ok: true, count: accounts.length });
}
