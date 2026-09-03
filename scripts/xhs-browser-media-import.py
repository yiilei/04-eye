#!/usr/bin/env python3
"""Import a browser-observed Xiaohongshu media manifest through Caiguang validation."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

PROJECT = Path(__file__).resolve().parents[1]
CAPTURE = PROJECT / "scripts" / "xhs-capture.py"
CAPTURE_PYTHON = PROJECT / "vendor" / "XHS-Downloader" / ".venv" / "bin" / "python"
SENSITIVE_KEYS = {"cookie", "cookies", "headers", "authorization", "xsec_token", "xsectoken"}
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_MEDIA_ITEMS = 100
QUEUE_PATH = PROJECT / "data" / "xhs-capture-queue.json"


class SafeCdnRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        validate_public_url(new_url, media=True)
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def validate_public_url(url: str, *, media: bool = False) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("仅允许无凭据的 HTTPS URL")
    host = (parsed.hostname or "").lower()
    if media:
        if not host.endswith(".xhscdn.com"):
            raise ValueError(f"拒绝非小红书 CDN 域名：{host or 'missing'}")
    elif host not in {"www.xiaohongshu.com", "xiaohongshu.com"}:
        raise ValueError(f"帖子地址不是小红书域名：{host or 'missing'}")
    query_keys = {key.lower() for key, _value in parse_qsl(parsed.query, keep_blank_values=True)}
    if query_keys & SENSITIVE_KEYS:
        raise ValueError("清单 URL 不得携带会话令牌")
    return url


def reject_sensitive_fields(value: object, path: str = "manifest") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if str(key).lower() in SENSITIVE_KEYS:
                raise ValueError(f"清单包含敏感字段：{path}.{key}")
            reject_sensitive_fields(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            reject_sensitive_fields(child, f"{path}[{index}]")


def validate_manifest(data: dict) -> dict:
    reject_sensitive_fields(data)
    post_id = str(data.get("postId", "")).strip()
    title = str(data.get("title", "")).strip()
    caption = str(data.get("caption", "")).strip()
    author = data.get("author") or {}
    source_url = validate_public_url(str(data.get("sourceUrl", "")))
    images = data.get("images")
    live_photos = data.get("livePhotos", [])
    published_at = str(data.get("publishedAt", "")).strip()
    edited_at = str(data.get("editedAt", "")).strip()
    if not re.fullmatch(r"[0-9a-fA-F]{24}", post_id):
        raise ValueError("postId 必须是 24 位十六进制小红书帖子 ID")
    if not title or not isinstance(author, dict):
        raise ValueError("清单缺少 title 或 author")
    if post_id not in urlsplit(source_url).path:
        raise ValueError("sourceUrl 与 postId 不一致")
    if not isinstance(images, list) or not images or len(images) > MAX_MEDIA_ITEMS:
        raise ValueError("清单必须包含数量合理的完整图片列表")
    if not isinstance(live_photos, list):
        raise ValueError("livePhotos 必须是数组")
    expected = list(range(1, len(images) + 1))
    indexes = [int(item.get("index", 0)) for item in images]
    if indexes != expected:
        raise ValueError("图片序号必须从 1 开始连续且保持轮播顺序")
    for item in images:
        validate_public_url(str(item.get("url", "")), media=True)
        if int(item.get("width", 0)) <= 0 or int(item.get("height", 0)) <= 0:
            raise ValueError(f"第 {item.get('index')} 张图片缺少有效尺寸")
    live_indexes = [int(item.get("imageIndex", 0)) for item in live_photos]
    if len(set(live_indexes)) != len(live_indexes) or any(index not in expected for index in live_indexes):
        raise ValueError("Live Photo 必须唯一对应一张有效图片")
    for item in live_photos:
        validate_public_url(str(item.get("url", "")), media=True)
    return {
        "postId": post_id,
        "title": title,
        "caption": caption,
        "authorName": str(author.get("name", "")).strip(),
        "authorId": str(author.get("id", "")).strip(),
        "sourceUrl": source_url,
        "images": images,
        "livePhotos": live_photos,
        "publishedAt": published_at,
        "editedAt": edited_at,
    }


def download(url: str, target: Path) -> None:
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36",
        "Referer": "https://www.xiaohongshu.com/",
    })
    opener = urllib.request.build_opener(SafeCdnRedirectHandler())
    with opener.open(request, timeout=60) as response:
        validate_public_url(response.geturl(), media=True)
        with target.open("wb") as handle:
            shutil.copyfileobj(response, handle)
    if target.stat().st_size < 1024:
        raise RuntimeError(f"媒体文件过小：{target.name}")


def verify_downloads(source: Path, data: dict) -> None:
    hashes: set[str] = set()
    for item in data["images"]:
        file = source / f"asset_{item['index']}.webp"
        result = subprocess.run(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(file)],
            text=True, capture_output=True,
        )
        if result.returncode or "pixelWidth:" not in result.stdout or "pixelHeight:" not in result.stdout:
            raise RuntimeError(f"图片不可解析：{file.name}")
        width = int(result.stdout.split("pixelWidth: ", 1)[1].splitlines()[0])
        height = int(result.stdout.split("pixelHeight: ", 1)[1].splitlines()[0])
        if (width, height) != (int(item["width"]), int(item["height"])):
            raise RuntimeError(f"第 {item['index']} 张图片尺寸与页面清单不一致")
        digest = hashlib.sha256(file.read_bytes()).hexdigest()
        if digest in hashes:
            raise RuntimeError(f"检测到重复图片：{file.name}")
        hashes.add(digest)
    for item in data["livePhotos"]:
        file = source / f"asset_{item['imageIndex']}.mp4"
        if file.stat().st_size < 1024 or b"ftyp" not in file.read_bytes()[:64]:
            raise RuntimeError(f"Live Photo 不是有效 MP4：{file.name}")


def complete_queue_task(post_id: str, result: dict) -> None:
    if not QUEUE_PATH.exists():
        return
    queue = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    changed = False
    for task in queue.get("tasks", []):
        if task.get("type") != "note" or task.get("status") != "needs_browser_capture":
            continue
        if post_id not in str(task.get("sourceUrl", "")) and post_id not in str(task.get("id", "")):
            continue
        task["status"] = "completed"
        task["completedAt"] = result.get("capturedAt") or datetime.now().astimezone().isoformat(timespec="seconds")
        task["manifest"] = result.get("manifest", "")
        for key in ["attempts", "lastAttemptAt", "lastError", "nextAttemptAt", "failedAt", "failureType", "error"]:
            task.pop(key, None)
        changed = True
    if changed:
        temporary = QUEUE_PATH.with_suffix(f".json.{os.getpid()}.tmp")
        temporary.write_text(json.dumps(queue, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, QUEUE_PATH)


def main() -> int:
    parser = argparse.ArgumentParser(description="导入 MyFlicker 从已授权页面观察到的完整媒体清单")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--date")
    args = parser.parse_args()
    staging_root: Path | None = None
    manifest_path = args.manifest.resolve()
    temp_root = Path(tempfile.gettempdir()).resolve()
    manifest_is_temporary = manifest_path.parent == temp_root or temp_root in manifest_path.parents
    try:
        if not manifest_is_temporary:
            raise ValueError("媒体清单必须位于系统临时目录")
        if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}", args.slug):
            raise ValueError("slug 只能包含字母、数字、下划线和连字符")
        if manifest_path.stat().st_size > MAX_MANIFEST_BYTES:
            raise ValueError("媒体清单超过 1 MiB")
        data = validate_manifest(json.loads(manifest_path.read_text(encoding="utf-8")))
        staging_root = Path(tempfile.mkdtemp(prefix="caiguang-browser-media-"))
        for item in data["images"]:
            download(item["url"], staging_root / f"asset_{item['index']}.webp")
        for item in data["livePhotos"]:
            download(item["url"], staging_root / f"asset_{item['imageIndex']}.mp4")
        verify_downloads(staging_root, data)
        command = [
            str(CAPTURE_PYTHON), str(CAPTURE),
            "--url", data["sourceUrl"],
            "--source-dir", str(staging_root),
            "--slug", args.slug,
            "--account-name", data["authorName"],
            "--account-id", data["authorId"],
            "--title", data["title"],
            "--caption", data["caption"],
        ]
        if data["publishedAt"]:
            command.extend(["--published-at", data["publishedAt"]])
        if data["editedAt"]:
            command.extend(["--edited-at", data["editedAt"]])
        if args.date:
            command.extend(["--date", args.date])
        result = subprocess.run(command, cwd=PROJECT, text=True, capture_output=True)
        output = (result.stdout or result.stderr).strip().splitlines()
        if result.returncode:
            raise RuntimeError(output[-1] if output else "采光规范化失败")
        parsed_result = json.loads(output[-1])
        if not parsed_result.get("ok"):
            raise RuntimeError(parsed_result.get("error") or "采光规范化失败")
        complete_queue_task(data["postId"], parsed_result)
        print(output[-1])
        return 0
    finally:
        if staging_root is not None:
            shutil.rmtree(staging_root, ignore_errors=True)
        if manifest_is_temporary:
            manifest_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
