import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";

const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const rawArgs = process.argv.slice(2).filter((value) => value !== "--");
const args = new Map();
for (let index = 0; index < rawArgs.length; index += 2) args.set(rawArgs[index], rawArgs[index + 1]);
const required = (key) => {
  const value = args.get(key);
  if (!value) throw new Error(`缺少参数 ${key}`);
  return value;
};

const sourceDir = path.resolve(required("--source-dir"));
const slug = required("--slug");
const title = required("--title");
const sourceUrl = required("--source-url");
const captureDate = args.get("--date") || new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
const displayDate = args.get("--display-date") || captureDate;
const targetDir = path.join(dataHome, "review", captureDate, slug);
const imageName = "full-page-hd.jpg";
const videoName = "preview.mp4";
const coverName = "thumbnail.png";

const sourceImagePath = path.join(sourceDir, imageName);
const sourceCoverPath = path.join(sourceDir, coverName);
for (const file of [sourceImagePath, sourceCoverPath]) await access(file);
const sourceVideoPath = path.join(sourceDir, videoName);
const hasVideo = await access(sourceVideoPath).then(() => true).catch(() => false);
const captureEvidencePath = path.join(sourceDir, "capture-result.json");
const captureEvidence = await readFile(captureEvidencePath, "utf8")
  .then((content) => JSON.parse(content))
  .catch(() => null);
if (!captureEvidence) throw new Error("缺少 H5 视频检测证据 capture-result.json，禁止登记为无视频");
if (!captureEvidence.excludedRecommendations) throw new Error("未证明已排除底部推荐流，禁止登记 H5");
if (Number(captureEvidence.videoCandidates || 0) > 0 && !hasVideo) {
  throw new Error("页面检测到视频资源但本地 MP4 缺失，禁止登记为无视频");
}

const dimensions = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", sourceImagePath], { encoding: "utf8" });
const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]);
const height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
if (!width || !height) throw new Error("无法读取 H5 长图尺寸");
const imageBytes = await readFile(sourceImagePath);
if (hasVideo) {
  const videoBytes = await readFile(sourceVideoPath);
  if (videoBytes.length < 1024 || !videoBytes.subarray(0, 64).toString("latin1").includes("ftyp")) throw new Error("头部动态文件不是有效 MP4");
}

const manifest = {
  schemaVersion: 1,
  id: slug,
  platform: "xiaohongshu",
  sourceType: "h5_event",
  postId: slug,
  account: { name: "小红书创作服务中心", xiaohongshuId: "creator_activity_center" },
  title,
  capturedAt: new Date().toISOString(),
  sourceUrl,
  sourceQuality: "web_highest_available",
  qualityEvidence: hasVideo
    ? "完整静态长图与头部 MP4 均来自已核验的网页最高可用清晰度素材。"
    : "完整静态长图来自已核验的网页最高可用清晰度渲染；自动检测未发现视频资源。",
  carouselOrderVerified: false,
  carouselOrderEvidence: "",
  images: [{ index: 1, path: imageName, width, height, sha256: createHash("sha256").update(imageBytes).digest("hex") }],
  videos: hasVideo ? [videoName] : [],
  expected: { imageCount: 1, livePhotoCount: 0, videoCount: hasVideo ? 1 : 0 },
  reviewState: "pending",
};

const prefix = `/media/${captureDate}/${slug}`;
const registryPath = path.join(dataHome, "data", "generated-review-items.json");
let registry = [];
try { registry = JSON.parse(await readFile(registryPath, "utf8")); } catch { /* first capture */ }
const imagePath = path.join(targetDir, imageName);
const item = {
  id: slug,
  postId: slug,
  title,
  summary: `小红书创作服务中心 · H5完整长图${hasVideo ? " · 1个头部视频" : ""}`,
  date: displayDate,
  capturedAt: captureDate,
  width,
  height,
  fallback: false,
  cover: `${prefix}/${coverName}`,
  image: `${prefix}/${imageName}`,
  localPath: imagePath,
  ...(hasVideo ? { video: `${prefix}/${videoName}`, videoLocalPath: path.join(targetDir, videoName) } : {}),
  sourceUrl,
  sourceQuality: "web_highest_available",
};
const nextRegistry = [item, ...registry.filter((existing) => existing.id !== slug && existing.postId !== slug)];

// Build in a private staging directory. Only after every source/evidence check
// passes do we atomically swap it into review, so a rejected capture cannot
// leave a half-populated item behind.
const reviewDateDir = path.dirname(targetDir);
const nonce = `${process.pid}-${Date.now()}`;
const stagingDir = path.join(reviewDateDir, `.${slug}.staging-${nonce}`);
const backupDir = path.join(reviewDateDir, `.${slug}.previous-${nonce}`);
const registryTemp = `${registryPath}.${nonce}.tmp`;
await mkdir(reviewDateDir, { recursive: true });
await mkdir(path.dirname(registryPath), { recursive: true });
await mkdir(stagingDir, { recursive: true });
let previousMoved = false;
let stagedInstalled = false;
try {
  await copyFile(sourceImagePath, path.join(stagingDir, imageName));
  await copyFile(sourceCoverPath, path.join(stagingDir, coverName));
  if (hasVideo) await copyFile(sourceVideoPath, path.join(stagingDir, videoName));
  await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  if (await access(targetDir).then(() => true).catch(() => false)) {
    await rename(targetDir, backupDir);
    previousMoved = true;
  }
  await rename(stagingDir, targetDir);
  stagedInstalled = true;
  await writeFile(registryTemp, `${JSON.stringify(nextRegistry, null, 2)}\n`);
  await rename(registryTemp, registryPath);
  if (previousMoved) await rm(backupDir, { recursive: true, force: true }).catch(() => {});
} catch (error) {
  await rm(registryTemp, { force: true }).catch(() => {});
  if (stagedInstalled) await rm(targetDir, { recursive: true, force: true }).catch(() => {});
  else await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  if (previousMoved) await rename(backupDir, targetDir).catch(() => {});
  throw error;
}
console.log(JSON.stringify({ ok: true, id: slug, images: 1, videos: hasVideo ? 1 : 0, width, height, manifest: path.join(targetDir, "manifest.json") }));
