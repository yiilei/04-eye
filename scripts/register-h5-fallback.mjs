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
const creatorCenterUrl = "https://creator.xiaohongshu.com/new/events";
const failure = args.get("--error") || "页面结构暂时无法识别";
const classifyFailure = (message) => {
  if (/尚未发布|应用不存在|链接已失效/u.test(message)) return { type: "活动尚未发布", advice: "进入创作服务中心活动列表，等待活动正式发布后再打开。" };
  if (/login_required|未登录|登录失效|Cookie/u.test(message)) return { type: "登录状态失效", advice: "回到采光重新同步小红书登录状态后再抓取。" };
  if (/风控|反爬|访问受限|403|验证/u.test(message)) return { type: "访问受到限制", advice: "稍后重试；若持续出现，请先在小红书网页正常访问一次。" };
  if (/selector|页面结构|模板|missing|Timeout.*locator/u.test(message)) return { type: "页面模板发生变化", advice: "采光已保留封面和入口，需要更新页面识别规则后重试。" };
  if (/MP4|视频|动态资源/u.test(message)) return { type: "视频素材未完整下载", advice: "为避免缺失动态素材，本次未保存为完整活动；可从创作服务中心进入查看。" };
  if (/timeout|timed out|网络|ECONN|HTTP 5\d\d/iu.test(message)) return { type: "网络或页面加载超时", advice: "检查网络或代理后重新抓取。" };
  if (/推荐流|边界/u.test(message)) return { type: "活动正文边界无法确认", advice: "为避免把推荐内容误存入素材，本次只保留封面和入口。" };
  return { type: "未知页面异常", advice: "可从创作服务中心进入查看，并保留此说明供后续诊断。" };
};
const failureInfo = classifyFailure(failure);
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
  title, capturedAt: new Date().toISOString(), sourceUrl: creatorCenterUrl, attemptedSourceUrl: sourceUrl, sourceQuality: "web_highest_available",
  qualityEvidence: `完整页面抓取失败，仅保留活动封面供定位。类型：${failureInfo.type}。原因：${failure}`,
  carouselOrderVerified: false, carouselOrderEvidence: "",
  images: [{ index: 1, path: coverName, width, height, sha256: createHash("sha256").update(coverBytes).digest("hex") }],
  videos: [], expected: { imageCount: 1, livePhotoCount: 0, videoCount: 0 }, reviewState: "preview_only",
};
await writeFile(path.join(stagingDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

let registry = [];
try { registry = JSON.parse(await readFile(registryPath, "utf8")); } catch { /* first item */ }
const prefix = `/media/${captureDate}/${slug}`;
const caption = `活动正文暂未上线，本条为兜底记录，不是完整素材。\n\n情况类型：${failureInfo.type}\n\n失败原因：${failure}\n\n当前保留：活动封面、失败原因、创作服务中心入口。\n\n后续处理：下次定时抓取或手动抓取时，采光会继续尝试；补抓成功前不会通过 YES 导入 Eagle。\n\n处理建议：${failureInfo.advice}\n点击上方链接可进入小红书创作服务中心，在活动列表中查找「${title}」。`;
const item = {
  id: slug, postId: slug, title, caption, summary: "小红书创作服务中心 · 抓取失败 · 已保留封面和创作服务中心入口",
  date: displayDate, capturedAt: captureDate, width, height, fallback: true, previewOnly: true,
  cover: `${prefix}/${coverName}`, image: `${prefix}/${coverName}`, localPath: path.join(targetDir, coverName),
  sourceUrl: creatorCenterUrl, attemptedSourceUrl: sourceUrl, sourceQuality: "web_highest_available",
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
