import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";
import { execFileSync } from "node:child_process";

const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const raw = process.argv.slice(2).filter((value) => value !== "--");
const args = new Map();
for (let index = 0; index < raw.length; index += 2) args.set(raw[index], raw[index + 1]);
const required = (key) => {
  const value = args.get(key);
  if (!value) throw new Error(`缺少参数 ${key}`);
  return value;
};

const slug = required("--slug");
const title = required("--title");
const sourceUrl = required("--source-url");
const failure = args.get("--error") || "页面结构暂时无法识别";
const captureDate = args.get("--date") || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const displayDate = args.get("--display-date") || captureDate;
const targetDir = path.join(dataHome, "review", captureDate, slug);
const registryPath = path.join(dataHome, "data", "generated-review-items.json");
const nonce = `${process.pid}-${Date.now()}`;
const stagingDir = `${targetDir}.fallback-${nonce}`;
const coverName = "fallback-cover.jpg";
const stagedCover = path.join(stagingDir, coverName);

await mkdir(stagingDir, { recursive: true });
let coverBytes = null;
const coverUrl = args.get("--cover-url");
if (coverUrl) {
  try {
    const response = await fetch(coverUrl, { headers: { Referer: sourceUrl, "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20_000) });
    if (response.ok) coverBytes = Buffer.from(await response.arrayBuffer());
  } catch { /* fall through to captured thumbnail */ }
}
if (!coverBytes && args.get("--source-dir")) {
  const thumbnail = path.join(path.resolve(args.get("--source-dir")), "thumbnail.png");
  if (await access(thumbnail).then(() => true).catch(() => false)) coverBytes = await readFile(thumbnail);
}
if (!coverBytes || coverBytes.length < 1024) {
  await rm(stagingDir, { recursive: true, force: true });
  throw new Error("无法下载活动封面，未生成空白兜底条目");
}
await writeFile(stagedCover, coverBytes);
const dimensions = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", stagedCover], { encoding: "utf8" });
const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]);
const height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
if (!width || !height) throw new Error("无法读取活动封面尺寸");

const manifest = {
  schemaVersion: 1, id: slug, platform: "xiaohongshu", sourceType: "h5_event", postId: slug,
  account: { name: "小红书创作服务中心", xiaohongshuId: "creator_activity_center" },
  title, capturedAt: new Date().toISOString(), sourceUrl, sourceQuality: "web_highest_available",
  qualityEvidence: `完整页面抓取失败，仅保留活动封面供定位。原因：${failure}`,
  carouselOrderVerified: false, carouselOrderEvidence: "",
  images: [{ index: 1, path: coverName, width, height, sha256: createHash("sha256").update(coverBytes).digest("hex") }],
  videos: [], expected: { imageCount: 1, livePhotoCount: 0, videoCount: 0 }, reviewState: "preview_only",
};
await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

let registry = [];
try { registry = JSON.parse(await readFile(registryPath, "utf8")); } catch { /* first item */ }
const prefix = `/media/${captureDate}/${slug}`;
const caption = `完整页面抓取失败\n\n失败原因：${failure}\n\n处理建议：点击上方原链接，进入对应活动页面自行体验。`;
const item = {
  id: slug, postId: slug, title, caption, summary: "小红书创作服务中心 · 抓取失败 · 已保留封面和原链接",
  date: displayDate, capturedAt: captureDate, width, height, fallback: true, previewOnly: true,
  cover: `${prefix}/${coverName}`, image: `${prefix}/${coverName}`, localPath: path.join(targetDir, coverName),
  sourceUrl, sourceQuality: "web_highest_available",
};
const next = [item, ...registry.filter((entry) => entry.id !== slug && entry.postId !== slug)];
await mkdir(path.dirname(registryPath), { recursive: true });
const backup = `${targetDir}.previous-${nonce}`;
let moved = false;
try {
  if (await access(targetDir).then(() => true).catch(() => false)) { await rename(targetDir, backup); moved = true; }
  await rename(stagingDir, targetDir);
  const temp = `${registryPath}.${nonce}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`);
  await rename(temp, registryPath);
  if (moved) await rm(backup, { recursive: true, force: true });
} catch (error) {
  await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  if (moved) await rename(backup, targetDir).catch(() => {});
  throw error;
}
console.log(JSON.stringify({ ok: true, id: slug, fallback: true, manifest: path.join(targetDir, "manifest.json") }));
