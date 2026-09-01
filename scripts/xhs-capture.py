#!/usr/bin/env python3
"""Download every note asset, normalize it, and validate it for review."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

PROJECT = Path(__file__).resolve().parents[1]
ENGINE = PROJECT / "vendor/XHS-Downloader/main.py"
PYTHON = PROJECT / "vendor/XHS-Downloader/.venv/bin/python"
DATA_HOME = Path(os.environ.get("SHARP_EYE_HOME", Path.home() / "Library/Application Support/采光")).expanduser()
DEFAULT_OUTPUT = DATA_HOME / "review"
REGISTRY = DATA_HOME / "data/generated-review-items.json"
STAGING = DATA_HOME / "data/capture-staging"
LOCK_FILE = DATA_HOME / "data/xhs-capture.lock"
IMAGE_SUFFIXES = {".webp", ".jpeg", ".jpg", ".png", ".avif", ".heic"}
VIDEO_SUFFIXES = {".mp4", ".mov"}


def post_id_from_url(url: str) -> str:
    parts = [part for part in urlparse(url).path.split("/") if part]
    if not parts:
        raise ValueError("链接里没有找到帖子 ID")
    return parts[-1]


def natural_key(path: Path) -> tuple:
    pieces = re.split(r"(\d+)", path.stem)
    return tuple(int(piece) if piece.isdigit() else piece.lower() for piece in pieces)


def media_index(path: Path) -> int | None:
    match = re.search(r"(?:^|[_-])(\d+)$", path.stem)
    return int(match.group(1)) if match else None


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_size(path: Path) -> tuple[int, int]:
    result = subprocess.run(
        ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
        text=True, capture_output=True,
    )
    width = re.search(r"pixelWidth: (\d+)", result.stdout)
    height = re.search(r"pixelHeight: (\d+)", result.stdout)
    if result.returncode or not width or not height:
        raise RuntimeError(f"无法读取图片尺寸：{path.name}")
    return int(width.group(1)), int(height.group(1))


def read_metadata(database: Path, post_id: str) -> dict:
    if not database.exists():
        return {}
    connection = sqlite3.connect(database)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            'SELECT * FROM explore_data WHERE "作品ID" = ?', (post_id,)
        ).fetchone()
        return dict(row) if row else {}
    finally:
        connection.close()


def run_engine(url: str, stage: Path) -> tuple[Path, dict, str]:
    if not PYTHON.exists() or not ENGINE.exists():
        raise RuntimeError("本地下载引擎未安装完整")
    command = [
        str(PYTHON), str(ENGINE), "--url", url,
        "--work_path", str(stage), "--folder_name", "Download",
        "--name_format", "作品ID", "--record_data", "true",
        "--image_format", "WEBP", "--live_download", "true",
        "--download_record", "false", "--folder_mode", "true",
        "--video_preference", "resolution", "--language", "zh_CN",
    ]
    result = subprocess.run(command, cwd=PROJECT, text=True, capture_output=True)
    log = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
    if result.returncode or "成功 0 个" in log or "获取数据失败" in log:
        reason = log.splitlines()[-1] if log else f"退出码 {result.returncode}"
        raise RuntimeError(f"下载引擎未取得帖子：{reason}")
    post_id = post_id_from_url(url)
    download_root = stage / "Download"
    metadata = read_metadata(download_root / "ExploreData.db", post_id)
    return download_root, metadata, log


def collect_media(root: Path) -> tuple[list[Path], list[Path]]:
    images = sorted(
        (p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES),
        key=natural_key,
    )
    videos = sorted(
        (p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES),
        key=natural_key,
    )
    if not images and not videos:
        raise RuntimeError("下载完成但没有找到任何图片或视频")
    return images, videos


def normalize(source_root: Path, output_root: Path, capture_date: str, slug: str,
              url: str, metadata: dict, account_name: str, account_id: str,
              title: str, caption: str = "") -> Path:
    images, videos = collect_media(source_root)
    target = output_root / capture_date / slug
    target.mkdir(parents=True, exist_ok=True)
    hashes: dict[str, str] = {}
    normalized_images = []
    source_index_to_target: dict[int, int] = {}

    source_indices = [media_index(source) for source in images]
    if images and source_indices != list(range(1, len(images) + 1)):
        raise RuntimeError(
            "组图源序号不连续，无法证明轮播顺序；已阻止进入批阅页"
        )

    for source in images:
        digest = sha256(source)
        if digest in hashes:
            raise RuntimeError(f"检测到重复图片：{source.name} 与 {hashes[digest]}")
        hashes[digest] = source.name
        position = len(normalized_images) + 1
        source_index = media_index(source)
        if source_index is None:
            raise RuntimeError(f"图片缺少源序号：{source.name}")
        source_index_to_target[source_index] = position
        destination = target / f"{position:02d}{source.suffix.lower()}"
        shutil.copy2(source, destination)
        width, height = image_size(destination)
        normalized_images.append({"index": position, "sourceIndex": source_index,
                                  "path": destination.name,
                                  "width": width, "height": height, "sha256": digest})

    loose_videos: list[str] = []
    for source in videos:
        source_index = media_index(source)
        if source_index and source_index in source_index_to_target and normalized_images:
            position = source_index_to_target[source_index]
            destination = target / f"live-{position:02d}.mp4"
            shutil.copy2(source, destination)
            normalized_images[position - 1]["livePhotoVideo"] = destination.name
        else:
            destination = target / ("video.mp4" if not loose_videos else f"video-{len(loose_videos) + 1:02d}.mp4")
            shutil.copy2(source, destination)
            loose_videos.append(destination.name)

    # A standalone video can include one poster image. It remains a video post;
    # the poster must not make it look like a mixed gallery in the manifest.
    source_type = "note_video" if loose_videos else "note_gallery"
    manifest = {
        "schemaVersion": 1, "id": slug, "platform": "xiaohongshu",
        "sourceType": source_type,
        "postId": metadata.get("作品ID") or post_id_from_url(url),
        "account": {"name": account_name or metadata.get("作者昵称") or "待确认",
                    "xiaohongshuId": account_id or metadata.get("作者ID") or "待确认"},
        "title": title or metadata.get("作品标题") or slug,
        "caption": caption or metadata.get("作品描述") or "",
        "capturedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sourceUrl": url, "sourceQuality": "web_highest_available",
        "qualityEvidence": "使用页面可获得的最高分辨率媒体地址下载，未二次压缩。",
        "carouselOrderVerified": bool(normalized_images) and source_indices == list(range(1, len(images) + 1)),
        "carouselOrderEvidence": (
            "XHS-Downloader 按页面 imageList 顺序生成 _1…_N 文件；采光逐项记录 "
            "sourceIndex、尺寸、SHA-256 与 Live Photo 配对，并验证源序号连续。"
            if normalized_images else ""
        ),
        "images": normalized_images, "videos": loose_videos,
        "expected": {"imageCount": len(normalized_images),
                     "livePhotoCount": sum("livePhotoVideo" in image for image in normalized_images),
                     "videoCount": len(loose_videos)},
        "reviewState": "pending",
    }
    manifest_path = target / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest_path


def validate(manifest: Path) -> None:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    base = manifest.parent
    images = data.get("images", [])
    videos = data.get("videos", [])
    expected = data.get("expected", {})
    if images and data.get("carouselOrderVerified") is not True:
        raise RuntimeError("组图轮播顺序未经核验")
    if len(images) != expected.get("imageCount"):
        raise RuntimeError("图片数量与清单不一致")
    if len(videos) != expected.get("videoCount", 0):
        raise RuntimeError("视频数量与清单不一致")
    seen: set[str] = set()
    live_count = 0
    for position, item in enumerate(images, start=1):
        if item.get("index") != position:
            raise RuntimeError("图片序号不连续")
        if item.get("sourceIndex") != position:
            raise RuntimeError("图片源序号不连续")
        path = base / item["path"]
        if not path.is_file() or not path.stat().st_size:
            raise RuntimeError(f"图片缺失：{item['path']}")
        if image_size(path) != (item["width"], item["height"]):
            raise RuntimeError(f"图片尺寸不一致：{item['path']}")
        digest = sha256(path)
        if digest in seen:
            raise RuntimeError(f"检测到重复图片：{item['path']}")
        seen.add(digest)
        if live := item.get("livePhotoVideo"):
            live_count += 1
            validate_mp4(base / live)
    for video in videos:
        validate_mp4(base / video)
    if live_count != expected.get("livePhotoCount"):
        raise RuntimeError("Live Photo 数量与清单不一致")


def validate_mp4(path: Path) -> None:
    if not path.is_file() or path.stat().st_size < 1024:
        raise RuntimeError(f"视频缺失或过小：{path.name}")
    with path.open("rb") as handle:
        if b"ftyp" not in handle.read(64):
            raise RuntimeError(f"不是有效 MP4：{path.name}")


def register_for_app(manifest: Path) -> None:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    relative_folder = manifest.parent.resolve().relative_to(DEFAULT_OUTPUT.resolve()).as_posix()
    public_prefix = f"/media/{relative_folder}"
    local_prefix = str(manifest.parent)
    images = data["images"]
    first = images[0] if images else {"path": "", "width": 1080, "height": 1440}
    gallery = [f"{public_prefix}/{image['path']}" for image in images]
    local_gallery = [f"{local_prefix}/{image['path']}" for image in images]
    live_photos = {str(image["index"] - 1): f"{public_prefix}/{image['livePhotoVideo']}"
                   for image in images if image.get("livePhotoVideo")}
    local_live_photos = {str(image["index"] - 1): f"{local_prefix}/{image['livePhotoVideo']}"
                         for image in images if image.get("livePhotoVideo")}
    account = data["account"]["name"]
    counts = []
    if images:
        counts.append(f"{len(images)}张完整组图")
    if data.get("videos"):
        counts.append(f"{len(data['videos'])}个视频")
    if data["expected"].get("livePhotoCount"):
        counts.append(f"{data['expected']['livePhotoCount']}个实况")
    item = {
        "id": data["id"], "postId": data["postId"], "title": data["title"],
        "caption": data.get("caption", ""),
        "summary": f"{account} · {' · '.join(counts)}", "date": data["capturedAt"][:10],
        "capturedAt": data["capturedAt"][:10], "width": first["width"], "height": first["height"],
        "fallback": False, "cover": gallery[0] if gallery else "", "image": gallery[0] if gallery else "",
        "gallery": gallery, "galleryLocalPaths": local_gallery,
        "imageDimensions": [{"width": image["width"], "height": image["height"]} for image in images],
        "localPath": local_gallery[0] if local_gallery else "", "sourceUrl": data["sourceUrl"],
        "sourceQuality": data["sourceQuality"],
    }
    if live_photos:
        item["livePhotos"] = live_photos
        item["livePhotoLocalPaths"] = local_live_photos
    if data.get("videos"):
        item["videoPost"] = True
        item["video"] = f"{public_prefix}/{data['videos'][0]}"
        item["videoLocalPath"] = f"{local_prefix}/{data['videos'][0]}"
    registry = json.loads(REGISTRY.read_text(encoding="utf-8")) if REGISTRY.exists() else []
    registry = [existing for existing in registry
                if existing.get("id") != item["id"] and existing.get("postId") != item["postId"]]
    registry.insert(0, item)
    REGISTRY.parent.mkdir(parents=True, exist_ok=True)
    REGISTRY.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def capture(args: argparse.Namespace) -> dict:
    post_id = post_id_from_url(args.url)
    slug = args.slug or post_id
    metadata: dict = {}
    engine_log = "offline fixture"
    generated_stage: Path | None = None
    if args.source_dir:
        source_root = args.source_dir.resolve()
        if not source_root.exists():
            raise RuntimeError(f"离线素材目录不存在：{source_root}")
    else:
        stage = STAGING / f"{args.date}-{post_id}"
        generated_stage = stage
        stage.mkdir(parents=True, exist_ok=True)
        source_root, metadata, engine_log = run_engine(args.url, stage)

    manifest = normalize(source_root, args.output_root.resolve(), args.date, slug, args.url,
                         metadata, args.account_name, args.account_id, args.title, args.caption)
    validate(manifest)
    if args.output_root.resolve() == DEFAULT_OUTPUT.resolve():
        register_for_app(manifest)
        if generated_stage is not None:
            shutil.rmtree(generated_stage, ignore_errors=True)
    data = json.loads(manifest.read_text(encoding="utf-8"))
    return {"ok": True, "id": data["id"],
            "images": data["expected"]["imageCount"],
            "livePhotos": data["expected"]["livePhotoCount"],
            "videos": data["expected"]["videoCount"],
            "manifest": str(manifest.relative_to(PROJECT) if manifest.is_relative_to(PROJECT) else manifest),
            "engine": engine_log.splitlines()[-1] if engine_log else "done"}


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="完整采集小红书帖子并写入本地批阅目录")
    parser.add_argument("--url", required=True)
    parser.add_argument("--slug")
    parser.add_argument("--date", default=datetime.now().astimezone().date().isoformat())
    parser.add_argument("--account-name", default="")
    parser.add_argument("--account-id", default="")
    parser.add_argument("--title", default="")
    parser.add_argument("--caption", default="")
    parser.add_argument("--source-dir", type=Path, help="离线测试：使用已有完整媒体")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    clean_argv = [value for value in (sys.argv[1:] if argv is None else argv) if value != "--"]
    return parser.parse_args(clean_argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_FILE.open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        result = capture(args)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
