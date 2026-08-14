"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import generatedItemsData from "../data/generated-review-items.json";
import accountPinsData from "../data/xhs-account-pins.json";

type Decision = "kept" | "rejected";
type QualityState = "checking" | "passed" | "failed";
type HistoryEntry =
  | { kind: "decision"; id: string; previous?: Decision; decision: Decision; index: number }
  | { kind: "remove-single"; id: string; previousRemoved: number[]; removedPosition: number; previousDecision?: Decision; index: number }
  | { kind: "remove-item"; id: string; index: number };
type EagleResponse<T> = { status: "success" | "error"; data?: T; message?: string };
type PinAccount = {
  searchKey: string; xiaohongshuId: string; displayName: string; group: string;
  profileId: string; profileUrl: string; status: string;
  avatarLocalPath?: string; avatarUrl?: string; avatarVerifiedAt?: string;
  previousDisplayName?: string; lastSeenPostId?: string; lastCheckedAt?: string;
};
type ReviewItem = {
  id: string; title: string; summary: string; date: string; capturedAt: string;
  width: number; height: number; fallback: boolean; cover: string; image: string;
  localPath: string; sourceUrl: string; video?: string; videoLocalPath?: string;
  gallery?: string[]; galleryLocalPaths?: string[];
  imageDimensions?: Array<{ width: number; height: number }>;
  livePhotoIndex?: number; livePhotoVideo?: string; livePhotoLocalPath?: string;
  livePhotos?: Record<number, string>;
  livePhotoLocalPaths?: Record<number, string>;
  videoPost?: boolean;
  previewOnly?: boolean;
  sourceQuality?: "source_original" | "web_highest_available";
};

const projectRoot = "/Users/yilei/Documents/ChatGPT/小红书创作活动获取/public";
const eagleBase = "http://127.0.0.1:41595/api";
const humanitiesRevision = "20260813-order-fix-2";

const legacyItems: ReviewItem[] = [
  {
    id: "dance-picked-moments-20260813", title: "那些舞动的瞬间，都值得被pick ✨", summary: "舞蹈薯 · 最新非置顶帖子 · 4张完整组图", date: "今天",
    capturedAt: "2026-08-13", width: 1080, height: 1447, fallback: false,
    cover: "/review/2026-08-13/dance-picked-moments-20260813/01.webp",
    image: "/review/2026-08-13/dance-picked-moments-20260813/01.webp",
    gallery: Array.from({ length: 4 }, (_, index) => `/review/2026-08-13/dance-picked-moments-20260813/${String(index + 1).padStart(2, "0")}.webp`),
    galleryLocalPaths: Array.from({ length: 4 }, (_, index) => `${projectRoot}/review/2026-08-13/dance-picked-moments-20260813/${String(index + 1).padStart(2, "0")}.webp`),
    imageDimensions: [{ width: 1080, height: 1447 }, { width: 1076, height: 1441 }, { width: 1075, height: 1441 }, { width: 1076, height: 1441 }],
    localPath: `${projectRoot}/review/2026-08-13/dance-picked-moments-20260813/01.webp`, sourceUrl: "https://www.xiaohongshu.com/user/profile/68107a5700000000040309ce/6a7c0e4600000000330332dd?xsec_token=AB1vGyxMhLSlsSTOup5yhZXQlB1MY6WlvPe74Qoxi9-gc=&xsec_source=pc_user",
    sourceQuality: "web_highest_available",
  },
  {
    id: "humanities-place-story", title: "如果要讲述一个「地方」，你会从哪里开始？", summary: "人文薯 · 6张网页高清组图", date: "昨天 15:20",
    capturedAt: "2026-08-13", width: 1080, height: 1443, fallback: false,
    cover: `/review/2026-08-13/humanities-place-story/01.webp?v=${humanitiesRevision}`,
    image: `/review/2026-08-13/humanities-place-story/01.webp?v=${humanitiesRevision}`,
    gallery: Array.from({ length: 6 }, (_, index) => `/review/2026-08-13/humanities-place-story/${String(index + 1).padStart(2, "0")}.webp?v=${humanitiesRevision}`),
    galleryLocalPaths: Array.from({ length: 6 }, (_, index) => `${projectRoot}/review/2026-08-13/humanities-place-story/${String(index + 1).padStart(2, "0")}.webp`),
    imageDimensions: Array.from({ length: 6 }, () => ({ width: 1080, height: 1443 })),
    localPath: `${projectRoot}/review/2026-08-13/humanities-place-story/01.webp`,
    sourceUrl: "https://www.xiaohongshu.com/explore/6a7c1c4a000000003300caf3?xsec_token=AB1vGyxMhLSlsSTOup5yhZXXEhDtiWSjYtepkaM7Ni4ug=&xsec_source=pc_user",
    sourceQuality: "web_highest_available",
  },
  {
    id: "tech-google-dev-2026", title: "薯带你看2026Google开发者大会！", summary: "科技薯 · 3张网页高清组图", date: "昨天",
    capturedAt: "2026-08-13", width: 1080, height: 1443, fallback: false,
    cover: "/review/2026-08-13/tech-google-dev-2026/01.webp",
    image: "/review/2026-08-13/tech-google-dev-2026/01.webp",
    gallery: Array.from({ length: 3 }, (_, index) => `/review/2026-08-13/tech-google-dev-2026/${String(index + 1).padStart(2, "0")}.webp`),
    galleryLocalPaths: Array.from({ length: 3 }, (_, index) => `${projectRoot}/review/2026-08-13/tech-google-dev-2026/${String(index + 1).padStart(2, "0")}.webp`),
    imageDimensions: Array.from({ length: 3 }, () => ({ width: 1080, height: 1443 })),
    localPath: `${projectRoot}/review/2026-08-13/tech-google-dev-2026/01.webp`,
    sourceUrl: "https://www.xiaohongshu.com/explore/6a7b341d0000000022012fde?xsec_token=ABunjIwWQcMZxHQjhQQb7keXmJ1tHm98W9VZws-49nrqw=&xsec_source=pc_user",
    sourceQuality: "web_highest_available",
  },
  {
    id: "douyin-ecommerce-super-new-26", title: "营销设计｜超级开新26 视觉升级", summary: "抖音电商设计 · 14张网页高清组图", date: "发布于 3天前",
    capturedAt: "2026-08-13", width: 1080, height: 1440, fallback: false,
    cover: "/review/2026-08-13/douyin-ecommerce-super-new-26/01.webp",
    image: "/review/2026-08-13/douyin-ecommerce-super-new-26/01.webp",
    gallery: Array.from({ length: 14 }, (_, index) => `/review/2026-08-13/douyin-ecommerce-super-new-26/${String(index + 1).padStart(2, "0")}.webp`),
    galleryLocalPaths: Array.from({ length: 14 }, (_, index) => `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/${String(index + 1).padStart(2, "0")}.webp`),
    imageDimensions: [
      { width: 1080, height: 1440 }, { width: 960, height: 1280 }, { width: 1080, height: 1440 },
      { width: 1080, height: 1440 }, { width: 960, height: 1280 }, { width: 960, height: 1280 },
      { width: 960, height: 1280 }, { width: 1080, height: 1440 }, { width: 1080, height: 1440 },
      { width: 1080, height: 1440 }, { width: 959, height: 1280 }, { width: 960, height: 1280 },
      { width: 1080, height: 1440 }, { width: 1080, height: 1440 },
    ],
    livePhotos: {
      1: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-02.mp4",
      5: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-06.mp4",
      6: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-07.mp4",
      7: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-08.mp4",
      9: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-10.mp4",
      13: "/review/2026-08-13/douyin-ecommerce-super-new-26/live-14.mp4",
    },
    livePhotoLocalPaths: {
      1: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-02.mp4`,
      5: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-06.mp4`,
      6: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-07.mp4`,
      7: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-08.mp4`,
      9: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-10.mp4`,
      13: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/live-14.mp4`,
    },
    localPath: `${projectRoot}/review/2026-08-13/douyin-ecommerce-super-new-26/01.webp`,
    sourceUrl: "https://www.xiaohongshu.com/explore/6a79719d000000003203315d",
    sourceQuality: "web_highest_available",
  },
  {
    id: "redesign-82-day", title: "运营设计｜build inspire love 82小红书日", summary: "小红书REDesign · 12张组图", date: "发布于 1天前",
    capturedAt: "2026-08-13",
    width: 1080, height: 1440, fallback: false,
    cover: "/review/2026-08-13/redesign-82-day/01.webp",
    image: "/review/2026-08-13/redesign-82-day/01.webp",
    gallery: Array.from({ length: 12 }, (_, index) => `/review/2026-08-13/redesign-82-day/${String(index + 1).padStart(2, "0")}.webp`),
    livePhotoIndex: 8,
    livePhotoVideo: "/review/2026-08-13/redesign-82-day/live.mp4",
    livePhotoLocalPath: `${projectRoot}/review/2026-08-13/redesign-82-day/live.mp4`,
    localPath: `${projectRoot}/review/2026-08-13/redesign-82-day/01.webp`,
    galleryLocalPaths: Array.from({ length: 12 }, (_, index) => `${projectRoot}/review/2026-08-13/redesign-82-day/${String(index + 1).padStart(2, "0")}.webp`),
    sourceUrl: "https://www.xiaohongshu.com/explore/6a7a9616000000002403f33f?xsec_token=ABH9Emg6rQ_WBnqCx-AxNug_7aRei_hlH5zF9kSK4sIYE=&xsec_source=pc_feed",
  },
  {
    id: "redesign-pinned-showreel", title: "点击围观！小红书REDesign2024年设计名场面", summary: "小红书REDesign · 置顶视频", date: "2025-06-09",
    capturedAt: "2026-08-13", width: 1080, height: 1440, fallback: false,
    cover: "/review/2026-08-13/redesign-pinned-showreel/poster.webp",
    image: "/review/2026-08-13/redesign-pinned-showreel/poster.webp",
    video: "/review/2026-08-13/redesign-pinned-showreel/video.mp4",
    videoPost: true,
    localPath: `${projectRoot}/review/2026-08-13/redesign-pinned-showreel/poster.webp`,
    videoLocalPath: `${projectRoot}/review/2026-08-13/redesign-pinned-showreel/video.mp4`,
    sourceUrl: "https://www.xiaohongshu.com/explore/6842b800000000000f038a51",
  },
  {
    id: "redesign-pinned-recruitment", title: "招聘｜小红书REDesign招人啦📢", summary: "小红书REDesign · 置顶组图 · 15张", date: "2025-03-12",
    capturedAt: "2026-08-13", width: 1080, height: 1440, fallback: false,
    cover: "/review/2026-08-13/redesign-pinned-recruitment/01.webp",
    image: "/review/2026-08-13/redesign-pinned-recruitment/01.webp",
    gallery: Array.from({ length: 15 }, (_, index) => `/review/2026-08-13/redesign-pinned-recruitment/${String(index + 1).padStart(2, "0")}.webp`),
    galleryLocalPaths: Array.from({ length: 15 }, (_, index) => `${projectRoot}/review/2026-08-13/redesign-pinned-recruitment/${String(index + 1).padStart(2, "0")}.webp`),
    localPath: `${projectRoot}/review/2026-08-13/redesign-pinned-recruitment/01.webp`,
    sourceUrl: "https://www.xiaohongshu.com/explore/67cff174000000000603b551",
  },
  {
    id: "jx3-anniversary", title: "剑网3十七周年庆典", summary: "创作领限定动作瓜分15万", date: "08-13 至 09-13",
    capturedAt: "2026-08-13",
    width: 1125, height: 10889, fallback: false,
    cover: "/events/jx3-anniversary/thumbnail.png",
    image: "/events/jx3-anniversary/full-page-hd.jpg?v=sequential-rebuild-2",
    localPath: `${projectRoot}/events/jx3-anniversary/full-page-hd.jpg`,
    sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/b9cf5c1f68f34b31bc1964a7bc815e13?fullscreen=true&resource_instance_id=316655&naviHidden=yes&source=creator_activity_center",
  },
  {
    id: "minnan-reimport", title: "这也是闽南", summary: "欢迎分享闽南人的日常", date: "08-12 至 08-31",
    capturedAt: "2026-08-12",
    width: 1125, height: 14100, fallback: false,
    cover: "/review/2026-08-12/minnan/cover.jpg",
    image: "/review/2026-08-12/minnan/full-page-hd.jpg",
    localPath: `${projectRoot}/review/2026-08-12/minnan/full-page-hd.jpg`,
    sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/e4daacfbd9344278a0b229711d08c335?fullscreen=true&resource_instance_id=316517&naviHidden=yes&source=creator_activity_center",
  },
  {
    id: "summer-electronic-dream", title: "夏日电子梦", summary: "用数字艺术重构夏日感官", date: "08-03 至 09-10",
    capturedAt: "2026-08-11",
    width: 1125, height: 5967, fallback: false,
    cover: "/events/summer-electronic-dream/thumbnail.png",
    image: "/events/summer-electronic-dream/full-page-hd.jpg?v=original-layers-4",
    video: "/events/summer-electronic-dream/preview.mp4",
    localPath: `${projectRoot}/events/summer-electronic-dream/full-page-hd.jpg`,
    videoLocalPath: `${projectRoot}/events/summer-electronic-dream/preview.mp4`,
    sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/21af46ac931c4e47adc622c4df40fdc0?fullscreen=true&resource_instance_id=314275&naviHidden=yes&source=creator_activity_center",
  },
  {
    id: "odyssey-reimport", title: "重返奥德赛", summary: "@历史薯邀你重返奥德赛", date: "08-08 至 09-15",
    capturedAt: "2026-08-11",
    width: 1125, height: 24635, fallback: false,
    cover: "/events/odyssey/thumbnail.png",
    image: "/events/odyssey/full-page-hd.jpg",
    localPath: `${projectRoot}/events/odyssey/full-page-hd.jpg`,
    sourceUrl: "https://fe.xiaohongshu.com/ditto/vincent/aa65cb0e54e14c2883762bb30ad8c17d?fullscreen=true&resource_instance_id=316008&naviHidden=yes&source=creator_activity_center",
  },
];

// Historical items stay in source for recovery, but a fresh experiment only reads
// the generated queue populated by the capture pipeline.
void legacyItems;
const items: ReviewItem[] = import.meta.env.VITE_PUBLIC_DISTRIBUTION === "1" ? [] : generatedItemsData as ReviewItem[];
const starterPrompt = "帮我抓取最新的小红书创作服务活动";
const emptyItem: ReviewItem = {
  id: "empty", title: "暂无待批阅素材", summary: "下一次采集成功后会自动出现在这里", date: "",
  capturedAt: "", width: 1, height: 1, fallback: false, cover: "", image: "",
  localPath: "", sourceUrl: "", sourceQuality: "web_highest_available",
};

const storageKey = "xiaohongshu-review-fresh-v1";
const eagleStorageKey = "xiaohongshu-eagle-imports-fresh-v1";
const singleStorageKey = "xiaohongshu-eagle-single-images-fresh-v1";
const removedSingleStorageKey = "xiaohongshu-removed-single-images-fresh-v1";
const scheduleStorageKey = "sharp-eye-schedule-v1";
const dismissedItemsStorageKey = "sharp-eye-dismissed-review-items-v1";
const pinnedAccountsStorageKey = "sharp-eye-pinned-accounts-v1";
const manualPinAccountsStorageKey = "sharp-eye-manual-pin-accounts-v1";
const seededPinAccounts = accountPinsData.accounts as PinAccount[];

function findFolderId(folders: Array<{ id: string; name: string; children?: Array<{ id: string; name: string; children?: unknown[] }> }>, name: string): string | undefined {
  for (const folder of folders) {
    if (folder.name === name) return folder.id;
    const child = findFolderId((folder.children || []) as Array<{ id: string; name: string; children?: [] }>, name);
    if (child) return child;
  }
}

function expectedImageSize(item: ReviewItem, position: number) {
  return item.imageDimensions?.[position] ?? { width: item.width, height: item.height };
}

async function readImageSize(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("图片无法读取"));
    image.src = source;
  });
}

async function validateReviewItem(item: ReviewItem) {
  const sources = item.gallery ?? [item.image];
  if (!sources.length || new Set(sources).size !== sources.length) throw new Error("图片为空或存在重复项");
  if (item.gallery && item.galleryLocalPaths?.length !== item.gallery.length) throw new Error("本地图片数量与原帖不一致");
  for (const [position, source] of sources.entries()) {
    const actual = await readImageSize(source);
    const expected = expectedImageSize(item, position);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      throw new Error(`第 ${position + 1} 张尺寸异常：${actual.width}×${actual.height}`);
    }
  }
  const normalizedLivePhotos = item.livePhotos ?? (item.livePhotoIndex !== undefined && item.livePhotoVideo ? { [item.livePhotoIndex]: item.livePhotoVideo } : {});
  const normalizedLivePaths = item.livePhotoLocalPaths ?? (item.livePhotoIndex !== undefined && item.livePhotoLocalPath ? { [item.livePhotoIndex]: item.livePhotoLocalPath } : {});
  const liveEntries = Object.entries(normalizedLivePhotos);
  if (liveEntries.length !== Object.keys(normalizedLivePaths).length) throw new Error("Live Photo 数量与本地文件不一致");
  for (const [position, source] of liveEntries) {
    if (!sources[Number(position)]) throw new Error(`Live Photo 第 ${Number(position) + 1} 张位置无效`);
    await new Promise<void>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => video.duration > 0 ? resolve() : reject(new Error("动态文件时长异常"));
      video.onerror = () => reject(new Error(`第 ${Number(position) + 1} 张动态文件无法读取`));
      video.src = source;
    });
  }
}

async function ensureEagleFolder() {
  let folderResponse: Response;
  try {
    folderResponse = await fetch(`${eagleBase}/folder/list`, { cache: "no-store" });
  } catch {
    throw new Error("无法连接 Eagle，请先启动 Eagle 后再点 YES");
  }
  const folderResult = await folderResponse.json() as EagleResponse<Array<{ id: string; name: string; children?: [] }>>;
  if (folderResult.status !== "success" || !folderResult.data) throw new Error(folderResult.message || "无法读取 Eagle 文件夹");
  const existing = findFolderId(folderResult.data, "小红书");
  if (existing) return existing;
  const createResponse = await fetch(`${eagleBase}/folder/create`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({ folderName: "小红书" }),
  });
  const created = await createResponse.json() as EagleResponse<{ id: string }>;
  if (created.status !== "success" || !created.data?.id) throw new Error(created.message || "无法自动创建 Eagle / 小红书 文件夹");
  return created.data.id;
}

async function importItemToEagle(item: (typeof items)[number], removedPositions: number[] = []) {
  await validateReviewItem(item);
  for (const [sourceIndex, source] of (item.gallery ?? [item.image]).entries()) {
    const displayedSize = await readImageSize(source);
    const expectedSize = expectedImageSize(item, sourceIndex);
    if (displayedSize.width !== expectedSize.width || displayedSize.height !== expectedSize.height) {
      throw new Error(`清晰度校验未通过：实际 ${displayedSize.width}×${displayedSize.height}px，预期 ${expectedSize.width}×${expectedSize.height}px，已阻止导入`);
    }
  }

  const folderId = await ensureEagleFolder();

  const addFromPath = async (path: string, name: string, tags: string[]) => {
    const response = await fetch(`${eagleBase}/item/addFromPath`, {
      method: "POST",
      // text/plain is intentional: it avoids Eagle's unsupported OPTIONS preflight.
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({
        path,
        name,
        website: item.sourceUrl,
        tags,
        folderId,
        annotation: `${item.summary}\n活动时间：${item.date}\n抓取日期：${item.capturedAt}`,
      }),
    });
    const result = await response.json() as EagleResponse<string>;
    if (result.status !== "success") throw new Error(result.message || "Eagle 导入失败");
    return result.data;
  };

  const imageIds: Array<string | undefined> = [];
  if (item.galleryLocalPaths?.length) {
    for (const [position, path] of item.galleryLocalPaths.entries()) {
      if (removedPositions.includes(position)) continue;
      imageIds.push(await addFromPath(path, `${item.title} - ${String(position + 1).padStart(2, "0")}`, ["小红书", "账号帖子", "组图"]));
    }
  } else {
    imageIds.push(await addFromPath(item.localPath, `${item.title} - 高清长图`, ["小红书", "创作活动", "H5长图"]));
  }
  const eagleId = imageIds[0];
  let videoId: string | undefined;
  if ("videoLocalPath" in item && item.videoLocalPath) {
    videoId = await addFromPath(item.videoLocalPath, `${item.title} - 动态头图`, ["小红书", "创作活动", "H5动态头图", "MP4"]);
  } else if (item.livePhotoLocalPath) {
    videoId = await addFromPath(item.livePhotoLocalPath, `${item.title} - Live Photo`, ["小红书", "账号帖子", "Live Photo", "MP4"]);
  }
  const livePhotoIds: Array<string | undefined> = [];
  for (const [position, path] of Object.entries(item.livePhotoLocalPaths ?? {})) {
    if (removedPositions.includes(Number(position))) continue;
    livePhotoIds.push(await addFromPath(path, `${item.title} - Live Photo ${String(Number(position) + 1).padStart(2, "0")}`, ["小红书", "账号帖子", "Live Photo", "MP4"]));
  }

  if (eagleId) {
    const firstExpectedSize = expectedImageSize(item, 0);
    let verified = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt) await new Promise((resolve) => setTimeout(resolve, 500));
      const checkResponse = await fetch(`${eagleBase}/item/info?id=${encodeURIComponent(eagleId)}`, { cache: "no-store" });
      const checkResult = await checkResponse.json() as EagleResponse<{ width?: number; height?: number }>;
      if (checkResult.status === "success" && checkResult.data?.width === firstExpectedSize.width && checkResult.data?.height === firstExpectedSize.height) {
        verified = true;
        break;
      }
    }
    if (!verified) throw new Error("图片和视频已导入，但 Eagle 尺寸复核未通过，请暂停继续批阅");
  }
  return [...imageIds, videoId, ...livePhotoIds].filter(Boolean).join("|") || item.id;
}

async function importSingleToEagle(item: ReviewItem, position: number) {
  const source = item.gallery?.[position];
  const path = item.galleryLocalPaths?.[position];
  if (!source || !path) throw new Error("当前素材不是可单张保存的组图");
  const size = await readImageSize(source);
  const expected = expectedImageSize(item, position);
  if (size.width !== expected.width || size.height !== expected.height) throw new Error("当前图片尺寸校验未通过，已阻止导入");

  const folderId = await ensureEagleFolder();
  const response = await fetch(`${eagleBase}/item/addFromPath`, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      path, folderId, website: item.sourceUrl,
      name: `${item.title} - 单张精选 ${String(position + 1).padStart(2, "0")}`,
      tags: ["小红书", "单张精选", "账号帖子", "排版"],
      annotation: `${item.summary}\n原帖第 ${position + 1}/${item.gallery.length} 张\n抓取日期：${item.capturedAt}`,
    }),
  });
  const result = await response.json() as EagleResponse<string>;
  if (result.status !== "success" || !result.data) throw new Error(result.message || "单张图片导入 Eagle 失败");
  const ids = [result.data];
  const livePath = item.livePhotoLocalPaths?.[position]
    ?? (item.livePhotoIndex === position ? item.livePhotoLocalPath : undefined);
  if (livePath) {
    const liveResponse = await fetch(`${eagleBase}/item/addFromPath`, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ path: livePath, folderId, website: item.sourceUrl,
        name: `${item.title} - 单张精选 ${String(position + 1).padStart(2, "0")} Live Photo`,
        tags: ["小红书", "单张精选", "账号帖子", "Live Photo", "MP4"],
        annotation: `${item.summary}\n原帖第 ${position + 1}/${item.gallery.length} 张动态文件\n抓取日期：${item.capturedAt}` }),
    });
    const liveResult = await liveResponse.json() as EagleResponse<string>;
    if (liveResult.status !== "success" || !liveResult.data) throw new Error(liveResult.message || "Live Photo 导入 Eagle 失败");
    ids.push(liveResult.data);
  }
  return ids.join("|");
}

export default function Home() {
  const [runtimeItems, setRuntimeItems] = useState<ReviewItem[]>(items);
  const [libraryStatus, setLibraryStatus] = useState("正在连接本地资料库…");
  const [index, setIndex] = useState(0);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [eagleItems, setEagleItems] = useState<Record<string, string>>({});
  const [savedSingles, setSavedSingles] = useState<Record<string, string>>({});
  const [removedSingles, setRemovedSingles] = useState<Record<string, number[]>>({});
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [syncingId, setSyncingId] = useState<string>();
  const [eagleMessage, setEagleMessage] = useState("");
  const [eagleError, setEagleError] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [eagleSetupStatus, setEagleSetupStatus] = useState("尚未检测");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [captureTime, setCaptureTime] = useState("02:00");
  const [pushTime, setPushTime] = useState("11:00");
  const [pinSearch, setPinSearch] = useState("");
  const [pinProfileUrl, setPinProfileUrl] = useState("");
  const [pinLinkMessage, setPinLinkMessage] = useState("");
  const [manualPinAccounts, setManualPinAccounts] = useState<PinAccount[]>([]);
  const [pinnedAccountIds, setPinnedAccountIds] = useState<string[]>(() => seededPinAccounts.map((account) => account.profileId));
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [focusCanvasMode, setFocusCanvasMode] = useState(false);
  const [appVisible, setAppVisible] = useState(true);
  const [desktopAppMode, setDesktopAppMode] = useState(false);
  const [desktopPreferencesReady, setDesktopPreferencesReady] = useState(false);
  const [desktopTime, setDesktopTime] = useState("");
  const [windowOffset, setWindowOffset] = useState({ x: 0, y: 0 });
  const [windowSize, setWindowSize] = useState<{ width: number; height: number }>();
  const [quality, setQuality] = useState<{ state: QualityState; message: string }>({ state: "checking", message: "正在校验" });
  const [edgeBump, setEdgeBump] = useState<"left" | "right">();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const migrationStarted = useRef(false);
  const appShellRef = useRef<HTMLElement>(null);
  const windowDrag = useRef<{
    x: number; y: number; originX: number; originY: number;
    left: number; top: number; width: number; height: number;
  } | null>(null);
  const windowResize = useRef<{
    edge: string; x: number; y: number; width: number; height: number; offsetX: number; offsetY: number;
  } | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const reviewItems = useMemo(() => runtimeItems.filter((item) => !dismissedIds.includes(item.id)), [dismissedIds, runtimeItems]);
  const current = reviewItems[index] ?? emptyItem;
  const allPinAccounts = useMemo(() => [
    ...seededPinAccounts,
    ...manualPinAccounts.filter((manual) => !seededPinAccounts.some((account) => account.profileId === manual.profileId)),
  ], [manualPinAccounts]);
  const visiblePinAccounts = useMemo(() => {
    const query = pinSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) return allPinAccounts;
    return allPinAccounts.filter((account) =>
      account.displayName.toLocaleLowerCase("zh-CN").includes(query)
      || account.xiaohongshuId.toLocaleLowerCase("zh-CN").includes(query)
      || account.searchKey.toLocaleLowerCase("zh-CN").includes(query));
  }, [allPinAccounts, pinSearch]);
  const pinExport = useMemo(() => {
    const exportedAccounts = allPinAccounts
      .filter((account) => pinnedAccountIds.includes(account.profileId));
    const exportedManualAccounts = exportedAccounts.filter((account) => account.status === "pending_verification");
    return {
      count: exportedAccounts.length,
      href: `/api/export-pins?ids=${encodeURIComponent(exportedAccounts.map((account) => account.profileId).join(","))}&manual=${encodeURIComponent(JSON.stringify(exportedManualAccounts))}`,
      filename: `04的眼-小红书埋点-${new Date().toISOString().slice(0, 10)}.json`,
    };
  }, [allPinAccounts, pinnedAccountIds]);
  const removedCurrent = removedSingles[current.id] ?? [];
  const remainingGalleryPositions = current.gallery?.map((_source, position) => position).filter((position) => !removedCurrent.includes(position)) ?? [];
  const currentLivePhoto = current.livePhotos?.[galleryIndex]
    ?? (current.livePhotoIndex === galleryIndex ? current.livePhotoVideo : undefined);
  const displayedDimensions = expectedImageSize(current, galleryIndex);
  const accountName = current.summary.includes("·")
    ? current.summary.split("·")[0].trim()
    : current.sourceUrl.includes("creator_activity_center")
      ? "小红书创作服务中心"
      : "小红书";
  const accountProfileUrl = accountPinsData.accounts.find((account) => account.displayName === accountName)?.profileUrl
    ?? current.sourceUrl.match(/https:\/\/www\.xiaohongshu\.com\/user\/profile\/[^/?]+/)?.[0]
    ?? current.sourceUrl;
  const displayDate = current.date;
  const livePhotoCount = current.livePhotos ? Object.keys(current.livePhotos).length : current.livePhotoVideo ? 1 : 0;
  const materialLabel = current.previewOnly
    ? "快速预览 · 留下后下载完整素材"
    : current.gallery
      ? `${current.gallery.length} 张图片${livePhotoCount ? ` · ${livePhotoCount} 个 Live Photo` : ""}`
      : current.videoPost
        ? "1 个视频 · 1 张封面"
        : current.video
          ? "1 张长图 · 1 个视频"
          : "1 张 H5 长图";
  const mediaAspect = displayedDimensions.width / displayedDimensions.height;
  // Only genuinely horizontal material uses the stable 5:3 landscape frame.
  // Square and portrait material follows its own ratio; very tall material is
  // bounded to 9:16 and continues inside the scrolling canvas.
  const boundedMediaAspect = mediaAspect > 1 ? 5 / 3 : Math.max(9 / 16, mediaAspect);
  const usesTallScroll = mediaAspect < 9 / 16;
  // Wide material is always fitted inside the 5:3 review canvas. The old
  // horizontal scrolling mode made the source ratio overflow the canvas and
  // visually defeated the fixed 5:3 frame.
  const mediaMode = usesTallScroll ? "tall-scrolling-media" : "fit-media";
  const visibleSidebarWidth = focusCanvasMode ? 0 : (leftSidebarOpen ? 166 : 0) + 252;
  const adaptiveWindowWidth = `min(calc(100vw - 92px), calc(${(boundedMediaAspect * 90).toFixed(4)}vh + ${visibleSidebarWidth}px))`;
  const adaptiveWindowHeight = `min(90vh, calc(${(100 / boundedMediaAspect).toFixed(4)}vw - ${((92 + visibleSidebarWidth) / boundedMediaAspect).toFixed(2)}px))`;

  useEffect(() => {
    setWindowSize((size) => {
      if (!size) return size;
      const width = Math.min(window.innerWidth - 20, Math.max(848, (size.height - 2) * boundedMediaAspect + visibleSidebarWidth + 2));
      const height = (width - visibleSidebarWidth - 2) / boundedMediaAspect + 2;
      return { width, height };
    });
  }, [boundedMediaAspect, visibleSidebarWidth]);

  const startWindowDrag = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as Element;
    if (event.button !== 0 || target.closest("button, a, .traffic-lights")) return;
    const isVisibleHandle = Boolean(target.closest(".window-controls, .aside-chrome"));
    const workspaceRect = event.currentTarget.getBoundingClientRect();
    if (!isVisibleHandle && event.clientY - workspaceRect.top > 30) return;
    const shellRect = appShellRef.current?.getBoundingClientRect() ?? workspaceRect;
    event.preventDefault();
    windowDrag.current = {
      x: event.clientX, y: event.clientY, originX: windowOffset.x, originY: windowOffset.y,
      left: shellRect.left, top: shellRect.top, width: shellRect.width, height: shellRect.height,
    };
  }, [windowOffset]);

  const startWindowResize = useCallback((event: ReactMouseEvent<HTMLDivElement>, edge: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    windowResize.current = {
      edge, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height,
      offsetX: windowOffset.x, offsetY: windowOffset.y,
    };
  }, [windowOffset]);

  useEffect(() => {
    const moveWindow = (event: MouseEvent) => {
      const resize = windowResize.current;
      if (resize) {
        const deltaX = event.clientX - resize.x;
        const deltaY = event.clientY - resize.y;
        const movesLeft = resize.edge.includes("w");
        const movesRight = resize.edge.includes("e");
        const movesTop = resize.edge.includes("n");
        const movesBottom = resize.edge.includes("s");
        const proposedWidth = resize.width + (movesRight ? deltaX : movesLeft ? -deltaX : 0);
        const proposedHeight = resize.height + (movesBottom ? deltaY : movesTop ? -deltaY : 0);
        const nextWidth = Math.min(window.innerWidth - 20, Math.max(680, proposedWidth));
        const nextHeight = Math.min(window.innerHeight - 20, Math.max(420, proposedHeight));
        const appliedWidth = nextWidth - resize.width;
        const appliedHeight = nextHeight - resize.height;
        setWindowSize({ width: nextWidth, height: nextHeight });
        setWindowOffset({
          x: resize.offsetX + (movesRight ? appliedWidth / 2 : movesLeft ? -appliedWidth / 2 : 0),
          y: resize.offsetY + (movesBottom ? appliedHeight / 2 : movesTop ? -appliedHeight / 2 : 0),
        });
        return;
      }
      const drag = windowDrag.current;
      if (!drag) return;
      const rawDeltaX = event.clientX - drag.x;
      const rawDeltaY = event.clientY - drag.y;
      const minDeltaX = 8 - drag.left;
      const maxDeltaX = window.innerWidth - 8 - drag.left - drag.width;
      const minDeltaY = 34 - drag.top;
      const maxDeltaY = window.innerHeight - 8 - drag.top - drag.height;
      const deltaX = minDeltaX <= maxDeltaX ? Math.min(maxDeltaX, Math.max(minDeltaX, rawDeltaX)) : minDeltaX;
      const deltaY = minDeltaY <= maxDeltaY ? Math.min(maxDeltaY, Math.max(minDeltaY, rawDeltaY)) : minDeltaY;
      setWindowOffset({ x: drag.originX + deltaX, y: drag.originY + deltaY });
    };
    const stopWindow = () => { windowDrag.current = null; windowResize.current = null; };
    window.addEventListener("mousemove", moveWindow);
    window.addEventListener("mouseup", stopWindow);
    return () => {
      window.removeEventListener("mousemove", moveWindow);
      window.removeEventListener("mouseup", stopWindow);
    };
  }, []);

  const keepWindowVisible = useCallback(() => {
    const rect = appShellRef.current?.getBoundingClientRect();
    if (!rect) return;
    let deltaX = 0;
    let deltaY = 0;
    if (rect.width > window.innerWidth - 16) deltaX = 8 - rect.left;
    else if (rect.left < 8) deltaX = 8 - rect.left;
    else if (rect.right > window.innerWidth - 8) deltaX = window.innerWidth - 8 - rect.right;
    if (rect.height > window.innerHeight - 42) deltaY = 34 - rect.top;
    else if (rect.top < 34) deltaY = 34 - rect.top;
    else if (rect.bottom > window.innerHeight - 8) deltaY = window.innerHeight - 8 - rect.bottom;
    if (deltaX || deltaY) setWindowOffset((value) => ({ x: value.x + deltaX, y: value.y + deltaY }));
  }, []);

  useEffect(() => {
    const shell = appShellRef.current;
    if (!shell) return;
    let frame = 0;
    const scheduleBoundaryCheck = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(keepWindowVisible);
    };
    const observer = new ResizeObserver(scheduleBoundaryCheck);
    observer.observe(shell);
    shell.addEventListener("transitionend", scheduleBoundaryCheck);
    window.addEventListener("resize", scheduleBoundaryCheck);
    scheduleBoundaryCheck();
    return () => {
      observer.disconnect();
      shell.removeEventListener("transitionend", scheduleBoundaryCheck);
      window.removeEventListener("resize", scheduleBoundaryCheck);
      window.cancelAnimationFrame(frame);
    };
  }, [appVisible, keepWindowVisible]);

  useEffect(() => {
    if (!reviewItems.length) return;
    let active = true;
    setQuality({ state: "checking", message: "正在校验" });
    void validateReviewItem(current).then(() => {
      if (active) setQuality({ state: "passed", message: "素材校验通过" });
    }).catch((error) => {
      if (active) setQuality({ state: "failed", message: error instanceof Error ? error.message : "素材校验失败" });
    });
    return () => { active = false; };
  }, [current]);

  useEffect(() => {
    const desktop = new URLSearchParams(window.location.search).get("desktop") === "1";
    setDesktopAppMode(desktop);
    document.body.classList.toggle("sharp-eye-desktop", desktop);
    return () => document.body.classList.remove("sharp-eye-desktop");
  }, []);

  useEffect(() => {
    if (!desktopAppMode) return;
    let active = true;
    const refreshLibrary = async () => {
      try {
        const response = await fetch("/api/desktop/review-items", { cache: "no-store" });
        if (!response.ok) throw new Error("本地资料库暂时不可用");
        const payload = await response.json() as {
          items?: ReviewItem[];
          decisions?: Record<string, { decision?: Decision }>;
        };
        if (!active) return;
        const nextItems = Array.isArray(payload.items) ? payload.items : [];
        setRuntimeItems(nextItems);
        setLibraryStatus(nextItems.length ? `已发现 ${nextItems.length} 组素材，正在进入批阅页` : "已连接，等待 Codex 完成首次抓取…");
        if (payload.decisions) {
          const persisted = Object.fromEntries(Object.entries(payload.decisions)
            .filter(([, value]) => value?.decision === "kept" || value?.decision === "rejected")
            .map(([id, value]) => [id, value.decision as Decision]));
          setDecisions((currentDecisions) => ({ ...persisted, ...currentDecisions }));
        }
      } catch (error) {
        if (active) setLibraryStatus(error instanceof Error ? error.message : "本地资料库暂时不可用");
      }
    };
    void refreshLibrary();
    const timer = window.setInterval(() => void refreshLibrary(), 1_500);
    return () => { active = false; window.clearInterval(timer); };
  }, [desktopAppMode]);

  useEffect(() => {
    if (!desktopAppMode) return;
    let active = true;
    void fetch("/api/desktop/preferences", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("preferences unavailable");
        return response.json() as Promise<{
          captureTime?: string; pushTime?: string; pinnedAccountIds?: string[]; manualPinAccounts?: PinAccount[];
        }>;
      })
      .then((preferences) => {
        if (!active) return;
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.captureTime ?? "")) setCaptureTime(preferences.captureTime!);
        if (/^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.pushTime ?? "")) setPushTime(preferences.pushTime!);
        if (Array.isArray(preferences.pinnedAccountIds)) setPinnedAccountIds(preferences.pinnedAccountIds);
        if (Array.isArray(preferences.manualPinAccounts)) setManualPinAccounts(preferences.manualPinAccounts);
      })
      .catch(() => undefined)
      .finally(() => { if (active) setDesktopPreferencesReady(true); });
    return () => { active = false; };
  }, [desktopAppMode]);

  useEffect(() => {
    try { setDecisions(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { /* ignore invalid local data */ }
    try { setEagleItems(JSON.parse(localStorage.getItem(eagleStorageKey) || "{}")); } catch { /* ignore invalid local data */ }
    try { setSavedSingles(JSON.parse(localStorage.getItem(singleStorageKey) || "{}")); } catch { /* ignore invalid local data */ }
    try { setRemovedSingles(JSON.parse(localStorage.getItem(removedSingleStorageKey) || "{}")); } catch { /* ignore invalid local data */ }
    try { setDismissedIds(JSON.parse(localStorage.getItem(dismissedItemsStorageKey) || "[]")); } catch { /* ignore invalid local data */ }
    try {
      const savedPins = JSON.parse(localStorage.getItem(pinnedAccountsStorageKey) || "null");
      if (Array.isArray(savedPins)) setPinnedAccountIds(savedPins);
    } catch { /* ignore invalid local data */ }
    try {
      const savedManualPins = JSON.parse(localStorage.getItem(manualPinAccountsStorageKey) || "[]");
      if (Array.isArray(savedManualPins)) setManualPinAccounts(savedManualPins);
    } catch { /* ignore invalid local data */ }
    try {
      const schedule = JSON.parse(localStorage.getItem(scheduleStorageKey) || "{}");
      if (/^\d{2}:\d{2}$/.test(schedule.captureTime)) setCaptureTime(schedule.captureTime);
      if (/^\d{2}:\d{2}$/.test(schedule.pushTime)) setPushTime(schedule.pushTime);
    } catch { /* ignore invalid local data */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    const updateClock = () => setDesktopTime(new Intl.DateTimeFormat("zh-CN", {
      month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date()));
    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    zoomRef.current = 1;
    setZoom(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
    requestAnimationFrame(() => viewer.current?.scrollTo({ top: 0, left: 0 }));
  }, [current.id]);

  useEffect(() => {
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
    requestAnimationFrame(() => viewer.current?.scrollTo({ top: 0, left: 0 }));
  }, [galleryIndex]);

  useEffect(() => { if (hydrated) localStorage.setItem(storageKey, JSON.stringify(decisions)); }, [decisions, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(eagleStorageKey, JSON.stringify(eagleItems)); }, [eagleItems, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(singleStorageKey, JSON.stringify(savedSingles)); }, [savedSingles, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(removedSingleStorageKey, JSON.stringify(removedSingles)); }, [removedSingles, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(dismissedItemsStorageKey, JSON.stringify(dismissedIds)); }, [dismissedIds, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(pinnedAccountsStorageKey, JSON.stringify(pinnedAccountIds)); }, [pinnedAccountIds, hydrated]);
  useEffect(() => { if (hydrated) localStorage.setItem(manualPinAccountsStorageKey, JSON.stringify(manualPinAccounts)); }, [manualPinAccounts, hydrated]);
  useEffect(() => {
    if (hydrated) localStorage.setItem(scheduleStorageKey, JSON.stringify({ captureTime, pushTime }));
  }, [captureTime, pushTime, hydrated]);
  useEffect(() => {
    if (!desktopAppMode || !desktopPreferencesReady) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/desktop/preferences", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureTime, pushTime, pinnedAccountIds, manualPinAccounts }),
      }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [captureTime, desktopAppMode, desktopPreferencesReady, manualPinAccounts, pinnedAccountIds, pushTime]);

  useEffect(() => {
    if (!hydrated || migrationStarted.current) return;
    migrationStarted.current = true;
    const pending = reviewItems.filter((item) => decisions[item.id] === "kept" && !eagleItems[item.id]);
    if (!pending.length) return;
    void (async () => {
      for (const item of pending) {
        setSyncingId(item.id);
        try {
          const eagleId = await importItemToEagle(item, removedSingles[item.id] ?? []);
          setEagleItems((value) => ({ ...value, [item.id]: eagleId }));
          setEagleError(false);
          setEagleMessage(`${item.title} 已补充导入 Eagle`);
        } catch (error) {
          setEagleError(true);
          setEagleMessage(error instanceof Error ? error.message : "Eagle 导入失败");
        }
      }
      setSyncingId(undefined);
    })();
  }, [decisions, eagleItems, hydrated, removedSingles, reviewItems]);

  const openItem = useCallback((next: number) => {
    setIndex(next);
    setGalleryIndex(0);
    zoomRef.current = 1;
    setZoom(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
    setEagleMessage("");
    setLinkCopied(false);
    viewer.current?.scrollTo({ top: 0, left: 0 });
  }, []);

  const resetZoom = useCallback(() => {
    zoomRef.current = 1;
    setZoom(1);
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, []);

  const reopenApplication = useCallback(() => {
    openItem(0);
    setWindowSize(undefined);
    setWindowOffset({ x: 0, y: 0 });
    setLeftSidebarOpen(true);
    setFocusCanvasMode(false);
    setAppVisible(true);
  }, [openItem]);

  const copyPostLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(current.sourceUrl);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 1600);
    } catch {
      setEagleError(true);
      setEagleMessage("复制链接失败，请使用左侧链接按钮打开原帖");
    }
  }, [current.sourceUrl]);

  useEffect(() => {
    const element = viewer.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.metaKey && !event.ctrlKey) {
        const nextPan = {
          x: panRef.current.x - event.deltaX,
          y: panRef.current.y - event.deltaY,
        };
        panRef.current = nextPan;
        setPan(nextPan);
        return;
      }
      const oldZoom = zoomRef.current;
      const nextZoom = Math.min(4, Math.max(.5, oldZoom * Math.exp(-event.deltaY * .01)));
      if (nextZoom === oldZoom) return;
      const rect = element.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - rect.width / 2;
      const pointerY = event.clientY - rect.top - rect.height / 2;
      const contentX = (pointerX - panRef.current.x) / oldZoom;
      const contentY = (pointerY - panRef.current.y) / oldZoom;
      const nextPan = { x: pointerX - contentX * nextZoom, y: pointerY - contentY * nextZoom };
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
      panRef.current = nextPan;
      setPan(nextPan);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const element = viewer.current;
    if (!element) return;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startPanX = 0;
    let startPanY = 0;
    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startPanX = panRef.current.x;
      startPanY = panRef.current.y;
      element.classList.add("panning");
    };
    const onMouseMove = (event: MouseEvent) => {
      if (!dragging) return;
      const nextPan = { x: startPanX + event.clientX - startX, y: startPanY + event.clientY - startY };
      panRef.current = nextPan;
      setPan(nextPan);
    };
    const stopDragging = () => {
      dragging = false;
      element.classList.remove("panning");
    };
    const preventMiddleClick = (event: MouseEvent) => { if (event.button === 1) event.preventDefault(); };
    element.addEventListener("mousedown", onMouseDown);
    element.addEventListener("auxclick", preventMiddleClick);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopDragging);
    return () => {
      element.removeEventListener("mousedown", onMouseDown);
      element.removeEventListener("auxclick", preventMiddleClick);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, []);

  const moveGallery = useCallback((direction: -1 | 1) => {
    if (!current.gallery?.length) return;
    setGalleryIndex((value) => {
      const currentVisibleIndex = remainingGalleryPositions.indexOf(value);
      const nextVisibleIndex = currentVisibleIndex + direction;
      if (nextVisibleIndex < 0 || nextVisibleIndex >= remainingGalleryPositions.length) {
        setEdgeBump(direction < 0 ? "left" : "right");
        window.setTimeout(() => setEdgeBump(undefined), 180);
        return value;
      }
      return remainingGalleryPositions[nextVisibleIndex];
    });
  }, [current.gallery, remainingGalleryPositions]);

  const persistDecision = useCallback((id: string, decision: Decision | "pending") => {
    if (!desktopAppMode) return;
    void fetch("/api/desktop/review-decision", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, decision }),
    }).then((response) => {
      if (!response.ok) throw new Error("decision write failed");
    }).catch(() => {
      setEagleError(true);
      setEagleMessage("本地资料库状态写入失败，请重试");
    });
  }, [desktopAppMode]);

  const saveCurrentSingle = useCallback(async () => {
    if (!current.gallery?.length) {
      setEagleError(true);
      setEagleMessage("当前是完整活动长图，不适用单张保存");
      return;
    }
    const key = `${current.id}:${galleryIndex}`;
    if (savedSingles[key] || syncingId) {
      if (savedSingles[key] && remainingGalleryPositions.length === 1) {
        const nextDecisions = { ...decisions, [current.id]: "kept" as Decision };
        setEagleItems((value) => ({ ...value, [current.id]: savedSingles[key] }));
        setHistory((value) => [...value, { kind: "decision", id: current.id, previous: decisions[current.id], decision: "kept", index }]);
        setDecisions(nextDecisions);
        persistDecision(current.id, "kept");
        setEagleMessage("最后一张此前已保存，本篇已自动完成");
        const pending = reviewItems.findIndex((_item, offset) => !nextDecisions[reviewItems[(index + offset + 1) % reviewItems.length].id]);
        if (pending >= 0) openItem((index + pending + 1) % reviewItems.length);
      } else if (savedSingles[key]) {
        setEagleMessage(`第 ${galleryIndex + 1} 张已经单独保存在 Eagle`);
      }
      return;
    }
    setSyncingId(key);
    setEagleError(false);
    setEagleMessage(`正在单独保存第 ${galleryIndex + 1} 张…`);
    try {
      await validateReviewItem(current);
      const eagleId = await importSingleToEagle(current, galleryIndex);
      setSavedSingles((value) => ({ ...value, [key]: eagleId }));
      if (remainingGalleryPositions.length === 1) {
        setEagleItems((value) => ({ ...value, [current.id]: eagleId }));
        setEagleMessage("最后一张已保存到 Eagle，本篇已自动完成");
        const nextDecisions = { ...decisions, [current.id]: "kept" as Decision };
        setHistory((value) => [...value, { kind: "decision", id: current.id, previous: decisions[current.id], decision: "kept", index }]);
        setDecisions(nextDecisions);
        persistDecision(current.id, "kept");
        const pending = reviewItems.findIndex((_item, offset) => !nextDecisions[reviewItems[(index + offset + 1) % reviewItems.length].id]);
        if (pending >= 0) openItem((index + pending + 1) % reviewItems.length);
      } else {
        setEagleMessage(`第 ${galleryIndex + 1} 张${currentLivePhoto ? "及对应 Live Photo " : ""}已单独保存到 Eagle；之后删除整篇也不会删除该素材`);
      }
    } catch (error) {
      setEagleError(true);
      setEagleMessage(error instanceof Error ? error.message : "单张图片导入失败");
    }
    setSyncingId(undefined);
  }, [current, currentLivePhoto, decisions, galleryIndex, index, openItem, persistDecision, remainingGalleryPositions.length, reviewItems, savedSingles, syncingId]);

  const commitDecision = useCallback((decision: Decision) => {
    const next = { ...decisions, [current.id]: decision };
    setHistory((value) => [...value, { kind: "decision", id: current.id, previous: decisions[current.id], decision, index }]);
    setDecisions(next);
    persistDecision(current.id, decision);
    const pending = reviewItems.findIndex((_item, offset) => {
      const candidate = (index + offset + 1) % reviewItems.length;
      return !next[reviewItems[candidate].id];
    });
    if (pending >= 0) openItem((index + pending + 1) % reviewItems.length);
  }, [current.id, decisions, index, openItem, persistDecision, reviewItems]);

  const removeCurrentSingle = useCallback(() => {
    if (!current.gallery?.length || syncingId) {
      setEagleError(true);
      setEagleMessage("当前素材不支持删除单张");
      return;
    }
    const nextRemoved = Array.from(new Set([...removedCurrent, galleryIndex])).sort((a, b) => a - b);
    const remaining = current.gallery.map((_source, position) => position).filter((position) => !nextRemoved.includes(position));
    setHistory((value) => [...value, { kind: "remove-single", id: current.id, previousRemoved: removedCurrent, removedPosition: galleryIndex, previousDecision: decisions[current.id], index }]);
    setRemovedSingles((value) => ({ ...value, [current.id]: nextRemoved }));
    if (!remaining.length) {
      setEagleMessage("全部图片都已移除，本篇已自动删除");
      const nextDecisions = { ...decisions, [current.id]: "rejected" as Decision };
      setDecisions(nextDecisions);
      persistDecision(current.id, "rejected");
      const pending = reviewItems.findIndex((_item, offset) => !nextDecisions[reviewItems[(index + offset + 1) % reviewItems.length].id]);
      if (pending >= 0) openItem((index + pending + 1) % reviewItems.length);
      return;
    }
    const nextPosition = remaining.find((position) => position > galleryIndex) ?? remaining.at(-1)!;
    setGalleryIndex(nextPosition);
    setEagleError(false);
    setEagleMessage(`已移除第 ${galleryIndex + 1} 张；留下时只保存剩余 ${remaining.length} 张`);
  }, [current, decisions, galleryIndex, index, openItem, persistDecision, removedCurrent, reviewItems, syncingId]);

  const decide = useCallback(async (decision: Decision) => {
    if (syncingId) return;
    if (decision === "rejected") {
      if (eagleItems[current.id]) {
        setEagleError(true);
        setEagleMessage("这条素材已经进入 Eagle，不能再从批阅页标记删除");
        return;
      }
      commitDecision(decision);
      return;
    }
    if (current.previewOnly) {
      setEagleError(false);
      setEagleMessage("已标记保留；现在开始下载完整原帖，完成核对后再进入 Eagle");
      commitDecision(decision);
      return;
    }
    if (!eagleItems[current.id]) {
      setSyncingId(current.id);
      setEagleError(false);
      setEagleMessage("正在导入 Eagle…");
      try {
        const eagleId = await importItemToEagle(current, removedCurrent);
        setEagleItems((value) => ({ ...value, [current.id]: eagleId }));
        setEagleMessage(`${current.title} 已导入 Eagle / 小红书${"videoLocalPath" in current ? "（静态长图和 MP4 两个独立文件）" : ""}`);
      } catch (error) {
        setEagleError(true);
        setEagleMessage(error instanceof Error ? error.message : "Eagle 导入失败");
        setSyncingId(undefined);
        return;
      }
      setSyncingId(undefined);
    }
    commitDecision(decision);
  }, [commitDecision, current, eagleItems, removedCurrent, syncingId]);

  const removeCurrentItem = useCallback(() => {
    if (!reviewItems.length || current.id === "empty") return;
    const removedIndex = index;
    const remainingCount = reviewItems.length - 1;
    setHistory((value) => [...value, { kind: "remove-item", id: current.id, index: removedIndex }]);
    setDismissedIds((value) => value.includes(current.id) ? value : [...value, current.id]);
    openItem(remainingCount ? Math.min(removedIndex, remainingCount - 1) : 0);
    setEagleError(false);
    setEagleMessage("已从批阅页面移除整组素材，可按 Command + Z 撤回");
  }, [current.id, index, openItem, reviewItems.length]);

  const undo = useCallback(() => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((value) => value.slice(0, -1));
    if (last.kind === "remove-item") {
      const nextDismissed = dismissedIds.filter((id) => id !== last.id);
      const restoredItems = runtimeItems.filter((item) => !nextDismissed.includes(item.id));
      const restoredIndex = restoredItems.findIndex((item) => item.id === last.id);
      setDismissedIds(nextDismissed);
      openItem(restoredIndex >= 0 ? restoredIndex : last.index);
      setEagleError(false);
      setEagleMessage("已撤回：整组素材已经恢复到批阅页面");
      return;
    }
    if (last.kind === "remove-single") {
      setRemovedSingles((value) => ({ ...value, [last.id]: last.previousRemoved }));
      setDecisions((value) => {
        const next = { ...value };
        if (last.previousDecision) next[last.id] = last.previousDecision;
        else delete next[last.id];
        return next;
      });
      persistDecision(last.id, last.previousDecision ?? "pending");
      openItem(last.index);
      setGalleryIndex(last.removedPosition);
      setEagleError(false);
      setEagleMessage(`已撤回：第 ${last.removedPosition + 1} 张已经恢复`);
      return;
    }
    setDecisions((value) => {
      const next = { ...value };
      if (last.previous) next[last.id] = last.previous;
      else delete next[last.id];
      return next;
    });
    persistDecision(last.id, last.previous ?? "pending");
    openItem(last.index);
    setEagleError(false);
    setEagleMessage(last.decision === "kept" && Boolean(eagleItems[last.id])
      ? "已撤回“留下”状态；为避免误删，已经导入 Eagle 的文件仍然保留"
      : "已撤回上一步");
  }, [dismissedIds, eagleItems, history, openItem, persistDecision, runtimeItems]);

  const undoCurrent = useCallback(() => {
    if (!decisions[current.id]) return;
    const wasKeptInEagle = decisions[current.id] === "kept" && Boolean(eagleItems[current.id]);
    setDecisions((value) => {
      const next = { ...value };
      delete next[current.id];
      return next;
    });
    setHistory((value) => value.filter((entry) => entry.id !== current.id));
    persistDecision(current.id, "pending");
    setEagleError(false);
    setEagleMessage(wasKeptInEagle
      ? "已撤回本条的“留下”状态；为避免误删，已经导入 Eagle 的文件仍然保留"
      : "已撤回本条，现在可以重新选择");
  }, [current.id, decisions, eagleItems, persistDecision]);

  const toggleAccountPin = useCallback((profileId: string) => {
    setPinnedAccountIds((value) => value.includes(profileId)
      ? value.filter((id) => id !== profileId)
      : [...value, profileId]);
  }, []);

  const openXiaohongshuUserSearch = useCallback(() => {
    const query = pinSearch.trim();
    if (!query) return;
    const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes&type=51`;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [pinSearch]);

  const addPinFromProfileUrl = useCallback(() => {
    const rawUrl = pinProfileUrl.trim();
    setPinLinkMessage("");
    try {
      const url = new URL(rawUrl);
      if (!/(^|\.)xiaohongshu\.com$/i.test(url.hostname)) throw new Error("host");
      const profileId = url.pathname.match(/^\/user\/profile\/([a-zA-Z0-9_-]+)/)?.[1];
      if (!profileId) throw new Error("profile");
      const existing = allPinAccounts.find((account) => account.profileId === profileId);
      if (!existing) {
        setManualPinAccounts((accounts) => [...accounts, {
          searchKey: profileId,
          xiaohongshuId: "待首次检查读取",
          displayName: "待核验账号",
          group: "manual_pending",
          profileId,
          profileUrl: `https://www.xiaohongshu.com/user/profile/${profileId}`,
          status: "pending_verification",
        }]);
      }
      setPinnedAccountIds((ids) => ids.includes(profileId) ? ids : [...ids, profileId]);
      setPinProfileUrl("");
      setPinLinkMessage(existing ? `已埋点：${existing.displayName}` : "主页已加入，首次检查时补齐账号资料");
    } catch {
      setPinLinkMessage("请粘贴小红书账号主页链接，不要粘贴帖子链接");
    }
  }, [allPinAccounts, pinProfileUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, [contenteditable='true']")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (!reviewItems.length) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        resetZoom();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && (event.code === "Period" || event.key === ".")) {
        event.preventDefault();
        setFocusCanvasMode((value) => !value);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Backspace") {
        event.preventDefault();
        removeCurrentItem();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Tab") openItem((index + (event.shiftKey ? -1 : 1) + reviewItems.length) % reviewItems.length);
      else if (event.key === "ArrowUp") void saveCurrentSingle();
      else if (event.key === "ArrowDown") removeCurrentSingle();
      else if (event.key === "ArrowLeft") moveGallery(-1);
      else if (event.key === "ArrowRight") moveGallery(1);
      else if (event.key === "Enter") void decide("kept");
      else if (event.code === "Quote") void decide("rejected");
      else if (event.key.toLowerCase() === "a") moveGallery(-1);
      else if (event.key.toLowerCase() === "d") moveGallery(1);
      else if (event.code === "Space") viewer.current?.scrollBy({ top: innerHeight * .72, behavior: "smooth" });
      else if (event.key.toLowerCase() === "f") resetZoom();
      else return;
      event.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [current.id, decide, decisions, index, moveGallery, openItem, removeCurrentItem, removeCurrentSingle, resetZoom, reviewItems.length, saveCurrentSingle, undo, undoCurrent]);

  if (!reviewItems.length) {
    return (
      <main className="app-shell first-run-shell">
        <section className="first-run-guide">
          <div className="first-run-title"><img src="/favicon.svg" alt="" /><span><strong>欢迎使用 04的眼</strong><small>三步完成首次设置</small></span></div>
          <div className="first-run-step"><b>1</b><span><strong>登录小红书</strong><small>在 Codex 内置浏览器打开小红书并扫码登录。</small></span><button onClick={() => window.open("https://www.xiaohongshu.com/explore", "_blank", "noopener,noreferrer")}>打开登录页</button></div>
          <div className="first-run-step"><b>2</b><span><strong>连接 Eagle</strong><small>先启动 Eagle，再检测本机连接。也可以稍后设置。</small></span><button onClick={() => { setEagleSetupStatus("检测中…"); void fetch("http://127.0.0.1:41595/api/application/info").then((response) => { if (!response.ok) throw new Error(); setEagleSetupStatus("已连接"); }).catch(() => setEagleSetupStatus("未连接，请先启动 Eagle")); }}>{eagleSetupStatus}</button></div>
          <div className="first-run-step prompt-step"><b>3</b><span><strong>把下面这句话发给 Codex</strong><code>{starterPrompt}</code></span><button onClick={() => void navigator.clipboard.writeText(starterPrompt).then(() => setSetupCopied(true))}>{setupCopied ? "已复制" : "复制"}</button></div>
          <p>{libraryStatus}</p>
        </section>
      </main>
    );
  }

  return (
    <>
      {!desktopAppMode && <div className="desktop-menu-bar" aria-label="桌面状态栏">
        <div className="desktop-menu-left"><strong>●</strong><b>{appVisible ? "04的眼" : "访达"}</b><span>文件</span><span>编辑</span><span>显示</span><span>窗口</span><span>帮助</span></div>
        <div className="desktop-menu-right"><span>⌁</span><span>◉</span><time>{desktopTime}</time></div>
      </div>}
      {appVisible && <main ref={appShellRef} className={`app-shell ${leftSidebarOpen ? "" : "left-sidebar-collapsed"} ${focusCanvasMode ? "focus-canvas-mode" : ""}`} style={desktopAppMode ? { width: "100vw", height: "100vh", transform: "none" } : { width: windowSize?.width ?? adaptiveWindowWidth, height: windowSize?.height ?? adaptiveWindowHeight, transform: `translate3d(${windowOffset.x}px, ${windowOffset.y}px, 0)` }}>
      {!desktopAppMode && (["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const).map((edge) => (
        <div key={edge} className={`window-resize-handle resize-${edge}`} onMouseDown={(event) => startWindowResize(event, edge)} aria-hidden="true" />
      ))}
      <section className="workspace" onMouseDown={desktopAppMode ? undefined : startWindowDrag}>
        <div className="window-controls">
          {!desktopAppMode && <div className="window-button-group traffic-lights">
            <button className="traffic-close" onClick={() => setAppVisible(false)} aria-label="退出04的眼" title="退出" />
            <button className="traffic-minimize" onClick={() => setAppVisible(false)} aria-label="最小化04的眼" title="最小化" />
            <button className="traffic-zoom" onClick={() => { setWindowSize(undefined); setWindowOffset({ x: 0, y: 0 }); }} aria-label="恢复默认窗口大小" title="恢复默认大小" />
          </div>}
          <button className="sidebar-toggle" onClick={() => setLeftSidebarOpen((value) => !value)} aria-label={leftSidebarOpen ? "收起左侧栏" : "展开左侧栏"}><span /><span /></button>
        </div>
        <nav aria-label="活动列表">
          <div className="sidebar-list">
            {reviewItems.map((item, itemIndex) => (
              <Fragment key={item.id}>
                {(itemIndex === 0 || reviewItems[itemIndex - 1].capturedAt !== item.capturedAt) && (
                  <div className="date-divider"><time>{item.capturedAt.replaceAll("-", ".")}</time><span /></div>
                )}
                <button className={itemIndex === index ? "active" : ""} onClick={() => openItem(itemIndex)}>
                  <img src={item.cover} alt="" style={{ aspectRatio: `${item.width} / ${Math.min(item.height, item.width * 4 / 3)}` }} />
                  <span><strong>{item.title}</strong><span className="thumbnail-meta"><small>{item.date}</small><span className="platform-pill" aria-label="小红书">小红书</span></span></span>
                  {decisions[item.id] && <i className={decisions[item.id]}>{decisions[item.id] === "kept" ? "留" : "删"}</i>}
                </button>
              </Fragment>
            ))}
          </div>
        </nav>

        <section className={`viewer ${mediaMode}`} ref={viewer} aria-label={`${current.title}完整长图`}>
          <div className="media-stage" style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, aspectRatio: `${displayedDimensions.width} / ${displayedDimensions.height}` }}>
            <div className={`h5-composite ${edgeBump ? `edge-bump-${edgeBump}` : ""}`} key={current.id}>
              <img src={current.gallery?.[galleryIndex] ?? current.image}
                width={current.imageDimensions?.[galleryIndex]?.width ?? current.width}
                height={current.imageDimensions?.[galleryIndex]?.height ?? current.height}
                alt={`${current.title}完整长图`} />
              {currentLivePhoto && (
                <video key={`${current.id}-${galleryIndex}`} className="gallery-live-photo" src={currentLivePhoto}
                  poster={current.gallery?.[galleryIndex] ?? current.image} autoPlay muted playsInline preload="auto"
                  onEnded={(event) => { event.currentTarget.style.display = "none"; }}
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                  aria-label={`${current.title}第${galleryIndex + 1}张动态图片`} />
              )}
              {"video" in current && current.video && (
                <video className={current.videoPost ? "post-video" : "h5-hero-video"} src={current.video} autoPlay muted loop={!current.videoPost} playsInline controls={current.videoPost} preload="metadata" aria-label={`${current.title}视频`} />
              )}
              {current.gallery && remainingGalleryPositions.length > 1 && <>
                <button className="gallery-hotspot gallery-hotspot-left" onClick={() => moveGallery(-1)} disabled={remainingGalleryPositions.indexOf(galleryIndex) === 0} aria-label="上一张" />
                <button className="gallery-hotspot gallery-hotspot-right" onClick={() => moveGallery(1)} disabled={remainingGalleryPositions.indexOf(galleryIndex) === remainingGalleryPositions.length - 1} aria-label="下一张" />
              </>}
            </div>
            {currentLivePhoto && <span className="live-badge">LIVE</span>}
          </div>
        </section>

        <aside className={settingsOpen ? "settings-mode" : ""}>
          <div className="aside-chrome">
            {settingsOpen ? (
              <button className="back-icon" onClick={() => setSettingsOpen(false)} aria-label="返回素材信息" title="返回">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
            ) : <span className="review-progress">{String(index + 1).padStart(2, "0")}/{String(reviewItems.length).padStart(2, "0")}</span>}
            <div className="post-link-actions">
              {!settingsOpen && (
                <button className={`post-link-icon ${linkCopied ? "copied" : ""}`} onClick={() => void copyPostLink()} aria-label={linkCopied ? "链接已复制" : "复制原帖链接"} title={linkCopied ? "已复制" : "复制原帖链接"}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5H6.8A2.8 2.8 0 0 0 4 7.8v9.4A2.8 2.8 0 0 0 6.8 20h9.4a2.8 2.8 0 0 0 2.8-2.8V15M13 4h7v7M20 4l-9 9" /></svg>
                </button>
              )}
              <button className={`settings-icon ${settingsOpen ? "active" : ""}`} onClick={() => setSettingsOpen(true)} aria-label="打开设置" title="设置">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.55v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-1.6-1H2.4V10h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.34-1.88L3.7 7.06 6.56 4.2l.06.06A1.7 1.7 0 0 0 8.5 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 18.9 9a1.7 1.7 0 0 0 1.6 1h.1v4h-.1a1.7 1.7 0 0 0-1.1 1Z" /></svg>
              </button>
            </div>
          </div>
          {settingsOpen ? (
            <div className="settings-content">
              <section className="settings-panel" aria-label="自动采集设置">
                <div className="settings-row">
                  <div><strong>抓取时间</strong><span>每天自动检查新内容</span></div>
                  <input type="time" value={captureTime} onChange={(event) => setCaptureTime(event.target.value)} aria-label="每天抓取时间" />
                </div>
                <div className="settings-row">
                  <div><strong>推送时间</strong><span>提醒你开始批阅</span></div>
                  <input type="time" value={pushTime} onChange={(event) => setPushTime(event.target.value)} aria-label="每天推送时间" />
                </div>
              </section>
              <section className="pin-panel" aria-label="小红书埋点账号">
                <label className="pin-search">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>
                  <input value={pinSearch} onChange={(event) => setPinSearch(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") openXiaohongshuUserSearch(); }}
                    placeholder="在小红书搜索用户" aria-label="在小红书搜索用户" />
                  <button type="button" onClick={openXiaohongshuUserSearch}>搜索</button>
                </label>
                <div className="pin-link-row">
                  <input value={pinProfileUrl} onChange={(event) => { setPinProfileUrl(event.target.value); setPinLinkMessage(""); }}
                    onKeyDown={(event) => { if (event.key === "Enter") addPinFromProfileUrl(); }}
                    placeholder="粘贴小红书账号主页链接" aria-label="小红书账号主页链接" />
                  <button type="button" onClick={addPinFromProfileUrl}>埋点</button>
                </div>
                {pinLinkMessage && <div className="pin-link-message">{pinLinkMessage}</div>}
                <div className="pin-list">
                  {visiblePinAccounts.map((account) => {
                    const pinned = pinnedAccountIds.includes(account.profileId);
                    return (
                      <div className="pin-account" key={account.profileId}>
                        <a className="pin-identity" href={account.profileUrl} target="_blank" rel="noreferrer" title="打开账号主页">
                          <span className="pin-avatar" aria-hidden="true">
                            {account.avatarLocalPath
                              ? <img src={account.avatarLocalPath} alt="" />
                              : account.displayName.slice(0, 1).toLocaleUpperCase("zh-CN")}
                          </span>
                          <span><strong>{account.displayName}</strong><small>小红书号 {account.xiaohongshuId}</small></span>
                        </a>
                        <button className={pinned ? "pin-toggle is-pinned" : "pin-toggle"} onClick={() => toggleAccountPin(account.profileId)}>
                          {pinned ? "取消埋点" : "埋点"}
                        </button>
                      </div>
                    );
                  })}
                  {!visiblePinAccounts.length && <div className="pin-empty">没有找到对应账号</div>}
                </div>
                <a className={`export-pins ${pinExport.count ? "" : "is-disabled"}`} href={pinExport.count ? pinExport.href : undefined}
                  download={pinExport.filename} aria-disabled={!pinExport.count}>
                  <span>一键导出埋点数据</span><small>{pinExport.count} 个账号</small>
                </a>
              </section>
            </div>
          ) : <>
            <div className="review-heading">
              <h1>{current.title}</h1>
              <div className="review-byline"><a href={accountProfileUrl} target="_blank" rel="noreferrer">@{accountName}</a><time aria-label={current.date}>{displayDate}</time></div>
            </div>
            <div className="review-info">
              <span>{materialLabel}</span>
              <a className="post-open-link" href={current.sourceUrl} target="_blank" rel="noreferrer" aria-label="打开原帖" title="打开原帖">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.2 13.8a4 4 0 0 0 5.6 0l2-2a4 4 0 0 0-5.6-5.6l-1.1 1.1M13.8 10.2a4 4 0 0 0-5.6 0l-2 2a4 4 0 1 0 5.6 5.6l1.1-1.1" /></svg>
              </a>
            </div>
            {quality.state === "failed" && <p className="quality-alert">{quality.message}</p>}
            <div className="actions">
              <button className="reject" onClick={() => void decide("rejected")} disabled={Boolean(syncingId) || Boolean(eagleItems[current.id])}>NO</button>
              <button className="keep" onClick={() => void decide("kept")} disabled={Boolean(syncingId) || quality.state !== "passed"}>YES</button>
            </div>
            {eagleMessage && <p className={`eagle-status ${eagleError ? "error" : ""}`}>{eagleMessage}</p>}
            <span className="gallery-position" aria-label={`当前第 ${galleryIndex + 1} 张，共 ${current.gallery?.length ?? 1} 张`}>{galleryIndex + 1}/{current.gallery?.length ?? 1}</span>
            <button className="undo" onClick={decisions[current.id] ? undoCurrent : undo} disabled={!history.length && !decisions[current.id]}>{decisions[current.id] ? "重新选择" : "撤回上一步"}</button>
          </>}
        </aside>
      </section>
      </main>}
      {!desktopAppMode && <div className="desktop-dock" aria-label="桌面应用栏">
        <button className="dock-icon finder-icon" aria-label="访达" title="访达">◒</button>
        <button className={`dock-icon review-app-icon ${appVisible ? "running" : ""}`} onClick={reopenApplication} aria-label="打开04的眼" title="04的眼"><img src="/favicon.svg" alt="" /></button>
        <button className="dock-icon" aria-label="浏览器" title="浏览器">◎</button>
        <button className="dock-icon" aria-label="照片" title="照片">✿</button>
        <span className="dock-divider" />
        <button className="dock-icon trash-icon" aria-label="废纸篓" title="废纸篓">⌫</button>
      </div>}
    </>
  );
}
