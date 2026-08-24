import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";

const projectRoot = process.cwd();
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

await mkdir(targetDir, { recursive: true });
for (const name of [imageName, coverName]) await copyFile(path.join(sourceDir, name), path.join(targetDir, name));
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
if (hasVideo) await copyFile(sourceVideoPath, path.join(targetDir, videoName));

const imagePath = path.join(targetDir, imageName);
const dimensions = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", imagePath], { encoding: "utf8" });
const width = Number(dimensions.match(/pixelWidth: (\d+)/)?.[1]);
const height = Number(dimensions.match(/pixelHeight: (\d+)/)?.[1]);
if (!width || !height) throw new Error("无法读取 H5 长图尺寸");
const imageBytes = await readFile(imagePath);
if (hasVideo) {
  const videoBytes = await readFile(path.join(targetDir, videoName));
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
await writeFile(path.join(targetDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const prefix = `/media/${captureDate}/${slug}`;
const registryPath = path.join(dataHome, "data", "generated-review-items.json");
await mkdir(path.dirname(registryPath), { recursive: true });
let registry = [];
try { registry = JSON.parse(await readFile(registryPath, "utf8")); } catch { /* first capture */ }
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
await writeFile(registryPath, `${JSON.stringify(nextRegistry, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, id: slug, images: 1, videos: hasVideo ? 1 : 0, width, height, manifest: path.join(targetDir, "manifest.json") }));
