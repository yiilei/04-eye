import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import os from "node:os";

const projectRoot = process.cwd();
const dataHome = path.resolve(process.env.SHARP_EYE_HOME || path.join(os.homedir(), "Library", "Application Support", "采光"));
const reviewRoot = path.join(dataHome, "review");
const targets = process.argv.slice(2);
let manifests = targets;
if (!targets.length) {
  try {
    manifests = (await readdir(reviewRoot, { recursive: true }))
      .filter((file) => file.endsWith("manifest.json"))
      .map((file) => path.join(reviewRoot, file));
  } catch { manifests = []; }
}

function imageSize(file) {
  const output = execFileSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const width = Number(output.match(/pixelWidth: (\d+)/)?.[1]);
  const height = Number(output.match(/pixelHeight: (\d+)/)?.[1]);
  if (!width || !height) throw new Error(`无法读取图片尺寸：${file}`);
  return { width, height };
}

async function validate(relativeManifest) {
  const manifestPath = path.resolve(projectRoot, relativeManifest);
  const base = path.dirname(manifestPath);
  const data = JSON.parse(await readFile(manifestPath, "utf8"));
  const errors = [];
  const hashes = new Map();
  if (data.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (!["note_gallery", "note_video", "h5_event"].includes(data.sourceType)) errors.push(`当前校验器不支持 sourceType=${data.sourceType}`);
  if (data.images.length !== data.expected.imageCount) errors.push("图片数量与 expected.imageCount 不一致");
  if (data.images.length > 1 && (!data.carouselOrderVerified || !data.carouselOrderEvidence)) errors.push("组图缺少原帖轮播顺序核对记录");
  if (data.sourceQuality === "source_original" && !data.qualityEvidence) errors.push("标记为原始母版时必须提供 qualityEvidence");

  let liveCount = 0;
  for (const [offset, image] of data.images.entries()) {
    if (image.index !== offset + 1) errors.push(`图片序号不连续：位置 ${offset + 1}`);
    const file = path.resolve(base, image.path);
    try {
      await access(file);
      const info = await stat(file);
      if (!info.size) errors.push(`空图片：${image.path}`);
      const actual = imageSize(file);
      if (actual.width !== image.width || actual.height !== image.height) errors.push(`${image.path} 尺寸 ${actual.width}×${actual.height}，清单为 ${image.width}×${image.height}`);
      const hash = createHash("sha256").update(await readFile(file)).digest("hex");
      if (hashes.has(hash)) errors.push(`${image.path} 与 ${hashes.get(hash)} 内容重复`);
      hashes.set(hash, image.path);
    } catch (error) {
      errors.push(error.message);
    }
    if (image.livePhotoVideo) {
      liveCount += 1;
      const video = path.resolve(base, image.livePhotoVideo);
      try {
        const bytes = await readFile(video);
        if (bytes.length < 1024 || !bytes.subarray(0, 64).toString("latin1").includes("ftyp")) errors.push(`${image.livePhotoVideo} 不是有效 MP4`);
      } catch (error) {
        errors.push(error.message);
      }
    }
  }
  if (liveCount !== data.expected.livePhotoCount) errors.push(`Live Photo 实际 ${liveCount}，预期 ${data.expected.livePhotoCount}`);
  const videos = data.videos ?? [];
  if (videos.length !== (data.expected.videoCount ?? 0)) errors.push("视频数量与 expected.videoCount 不一致");
  for (const relativeVideo of videos) {
    const video = path.resolve(base, relativeVideo);
    try {
      const bytes = await readFile(video);
      if (bytes.length < 1024 || !bytes.subarray(0, 64).toString("latin1").includes("ftyp")) errors.push(`${relativeVideo} 不是有效 MP4`);
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (errors.length) throw new Error(`${data.id}\n- ${errors.join("\n- ")}`);
  return `${data.id}: PASS · ${data.images.length} 张图片 · ${liveCount} 个 Live Photo 配对 · ${videos.length} 个视频 · 无重复图`;
}

let failed = false;
if (!manifests.length) console.log("review archive: EMPTY · 等待首次采集");
for (const manifest of manifests) {
  try { console.log(await validate(manifest)); }
  catch (error) { failed = true; console.error(`FAIL · ${error.message}`); }
}
if (failed) process.exitCode = 1;
