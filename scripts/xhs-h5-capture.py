#!/usr/bin/env python3
"""Capture the activity body at mobile width and archive every observed MP4."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import time
from contextlib import ExitStack
from pathlib import Path

from xhs_cli.auth import cookie_str_to_dict, get_cookie_string
from camoufox.sync_api import Camoufox
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright


NOTES_SELECTORS = (
    ".notes-container",
    ".dual-column-layout",
    "[class*='notes-container']",
)


def valid_mp4(payload: bytes) -> bool:
    return len(payload) >= 1024 and b"ftyp" in payload[:64]


def permanent_page_error(body_text: str) -> str | None:
    markers = ("该应用不存在", "请前往发布系统进行录入&发布")
    if any(marker in body_text for marker in markers):
        return "创作服务中心已展示活动，但活动 H5 尚未发布或链接已失效"
    return None


def jpeg_dimensions(payload: bytes) -> tuple[int, int]:
    """Read JPEG dimensions without adding Pillow to the clean installer."""
    if payload[:2] != b"\xff\xd8":
        raise ValueError("not a JPEG")
    offset = 2
    while offset + 9 < len(payload):
        if payload[offset] != 0xFF:
            offset += 1
            continue
        marker = payload[offset + 1]
        offset += 2
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(payload):
            break
        length = int.from_bytes(payload[offset:offset + 2], "big")
        if length < 2 or offset + length > len(payload):
            break
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            height = int.from_bytes(payload[offset + 3:offset + 5], "big")
            width = int.from_bytes(payload[offset + 5:offset + 7], "big")
            return width, height
        offset += length
    raise ValueError("JPEG dimensions not found")


def capture_covers_content(actual_height: int, content_height: float, scale: float) -> bool:
    expected_height = max(1, round(content_height * scale))
    return actual_height >= expected_height * 0.92


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--viewport-width", type=int, default=480)
    parser.add_argument("--output-width", type=int, default=1125)
    args = parser.parse_args()

    cookie = get_cookie_string()
    if not cookie:
        print(json.dumps({"ok": False, "status": "login_required"}, ensure_ascii=False))
        return 1

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / "full-page-hd.jpg"
    thumbnail_path = output_dir / "thumbnail.png"
    video_path = output_dir / "preview.mp4"

    scale = args.output_width / args.viewport_width
    chrome_path = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    with ExitStack() as stack:
        if chrome_path.exists():
            playwright = stack.enter_context(sync_playwright())
            browser = playwright.chromium.launch(headless=True, executable_path=str(chrome_path))
            stack.callback(browser.close)
            browser_engine = "system_chrome"
        else:
            browser = stack.enter_context(Camoufox(
                headless=True,
                fonts=["PingFang SC", "Hiragino Sans GB", "Arial Unicode MS"],
            ))
            browser_engine = "camoufox_fallback"
        context = browser.new_context(
            viewport={"width": args.viewport_width, "height": 900},
            device_scale_factor=scale,
        )
        context.add_cookies([
            {"name": key, "value": value, "domain": ".xiaohongshu.com", "path": "/"}
            for key, value in cookie_str_to_dict(cookie).items()
        ])
        page = context.new_page()
        page.goto(args.source_url, wait_until="domcontentloaded", timeout=45_000)
        page.wait_for_timeout(2_000)
        if "/login" in page.url:
            print(json.dumps({"ok": False, "status": "login_required", "url": page.url}, ensure_ascii=False))
            return 1

        body_text = page.locator("body").inner_text(timeout=5_000).strip()
        permanent_error = permanent_page_error(body_text)
        if permanent_error:
            error = {
                "ok": False,
                "status": "activity_unpublished",
                "error": permanent_error,
                "url": page.url,
            }
            print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
            return 2

        # Activity pages are served by several frontend generations.  Older
        # pages use #app, while newer campaigns may use data-v-app, main, or a
        # generated root node.  Wait for real rendered content instead of one
        # framework-specific selector.
        page.wait_for_function(
            """() => document.body && document.body.children.length > 0
              && (document.body.innerText.trim().length > 20 || document.images.length > 0)""",
            timeout=20_000,
        )

        # H5 activities load their Chinese web fonts after DOMContentLoaded.
        # Capturing before both fonts and lazy images settle produces visible
        # hexadecimal tofu boxes even though the same page becomes readable a
        # few seconds later in an interactive browser.
        try:
            page.wait_for_load_state("networkidle", timeout=20_000)
        except PlaywrightTimeoutError:
            # Activity pages keep analytics/streaming requests open. Font and
            # image readiness below are the authoritative capture gates.
            pass
        page.evaluate(
            """async () => {
              if (document.fonts?.ready) await document.fonts.ready;
              const pending = [...document.images]
                .filter(image => !image.complete)
                .map(image => new Promise(resolve => {
                  image.addEventListener('load', resolve, { once: true });
                  image.addEventListener('error', resolve, { once: true });
                }));
              await Promise.race([
                Promise.all(pending),
                new Promise(resolve => setTimeout(resolve, 10_000)),
              ]);
            }"""
        )
        page.wait_for_timeout(2_000)

        # Scroll through the activity body so lazy images/GIF layers are fully rendered.
        for _ in range(3):
            metrics = page.evaluate(
                """(selectors) => {
                  const app = document.querySelector('#app')
                    || document.querySelector('[data-v-app]')
                    || document.querySelector('main')
                    || [...document.body.children].sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
                    || document.body;
                  const notesTitle = [...document.querySelectorAll('*')]
                    .find(el => el.children.length === 0 && el.textContent.trim() === '精选笔记');
                  const notes = selectors.map(s => document.querySelector(s)).find(Boolean)
                    || notesTitle?.closest('.onix-wrapper') || notesTitle?.closest('.container');
                  const appRect = app.getBoundingClientRect();
                  const end = notes ? notes.getBoundingClientRect().top - appRect.top : app.scrollHeight;
                  return { end, viewport: innerHeight };
                }""",
                NOTES_SELECTORS,
            )
            step = max(360, int(metrics["viewport"] * 0.72))
            position = 0
            while position < metrics["end"]:
                page.evaluate("y => window.scrollTo(0, y)", position)
                page.wait_for_timeout(140)
                position += step
            page.evaluate("y => window.scrollTo(0, y)", max(0, metrics["end"] - metrics["viewport"]))
            page.wait_for_timeout(600)

        # Scrolling can trigger another wave of font/image requests. Require
        # two stable render fingerprints before producing the archive.
        previous_fingerprint = None
        stable_samples = 0
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and stable_samples < 2:
            page.evaluate("async () => { if (document.fonts?.ready) await document.fonts.ready; }")
            fingerprint = page.evaluate(
                """() => {
                  const app = document.querySelector('#app')
                    || document.querySelector('[data-v-app]')
                    || document.querySelector('main')
                    || [...document.body.children].sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
                    || document.body;
                  const text = app?.innerText || '';
                  const images = [...document.images].map(image =>
                    `${image.currentSrc || image.src}:${image.naturalWidth}x${image.naturalHeight}:${image.complete}`
                  ).join('|');
                  return `${text.length}:${text.slice(0, 1200)}:${images}`;
                }"""
            )
            stable_samples = stable_samples + 1 if fingerprint == previous_fingerprint else 0
            previous_fingerprint = fingerprint
            page.wait_for_timeout(1_000)

        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(350)
        capture = page.evaluate(
            r"""(selectors) => {
              const app = document.querySelector('#app')
                || document.querySelector('[data-v-app]')
                || document.querySelector('main')
                || [...document.body.children].sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
                || document.body;
              const notesTitle = [...document.querySelectorAll('*')]
                .find(el => el.children.length === 0 && el.textContent.trim() === '精选笔记');
              const notes = selectors.map(s => document.querySelector(s)).find(Boolean)
                || notesTitle?.closest('.onix-wrapper') || notesTitle?.closest('.container');
              const appRect = app.getBoundingClientRect();
              const end = notes ? notes.getBoundingClientRect().top - appRect.top : app.scrollHeight;
              const videos = [...document.querySelectorAll('video')]
                .map(v => v.currentSrc || v.src).filter(Boolean);
              const resources = performance.getEntriesByType('resource')
                .filter(entry => entry.initiatorType === 'video' || /\.mp4(?:\?|$)/i.test(entry.name))
                .map(entry => entry.name);
              for (const element of document.querySelectorAll('.template-h5-mask')) element.style.display = 'none';
              if (notes) notes.style.display = 'none';
              document.documentElement.style.width = `${appRect.width}px`;
              document.body.style.width = `${appRect.width}px`;
              document.body.style.margin = '0';
              return {
                contentWidth: appRect.width,
                contentHeight: Math.max(1, end),
                contentX: Math.max(0, appRect.left),
                contentY: Math.max(0, appRect.top),
                videos: [...new Set([...videos, ...resources])],
                // A missing recommendation container means the activity page
                // already ends at its own content. When one exists, the
                // screenshot is cut before it and the container is hidden.
                excludedRecommendations: true,
                recommendationBoundaryFound: Boolean(notes),
                deviceScaleFactor: devicePixelRatio,
              };
            }""",
            NOTES_SELECTORS,
        )

        # Chromium can silently crop a clip taller than the viewport to the
        # current compositor surface. Grow only the viewport height (the
        # responsive width stays unchanged) so the complete activity is
        # paintable before taking the archive screenshot.
        required_viewport_height = max(900, math.ceil(capture["contentY"] + capture["contentHeight"]) + 2)
        page.set_viewport_size({"width": args.viewport_width, "height": required_viewport_height})
        page.wait_for_timeout(350)
        image_bytes = page.screenshot(
            type="jpeg",
            quality=96,
            clip={
                "x": capture["contentX"],
                "y": capture["contentY"],
                "width": capture["contentWidth"],
                "height": capture["contentHeight"],
            },
            animations="disabled",
        )
        image_width, image_height = jpeg_dimensions(image_bytes)
        if not capture_covers_content(image_height, capture["contentHeight"], capture["deviceScaleFactor"]):
            expected_height = round(capture["contentHeight"] * capture["deviceScaleFactor"])
            raise RuntimeError(f"H5 截图不完整：页面应约 {expected_height}px 高，实际仅 {image_height}px")
        image_path.write_bytes(image_bytes)
        thumb_clip = {
            "x": 0,
            "y": 0,
            "width": capture["contentWidth"],
            "height": min(capture["contentHeight"], capture["contentWidth"] * 4 / 3),
        }
        page.screenshot(path=str(thumbnail_path), type="png", clip=thumb_clip, animations="disabled")

        downloaded_video = None
        for video_url in capture["videos"]:
            try:
                response = page.context.request.get(video_url, headers={"Referer": page.url}, timeout=30_000)
                body = response.body()
                if response.ok and valid_mp4(body):
                    video_path.write_bytes(body)
                    downloaded_video = {
                        "url": video_url,
                        "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(),
                    }
                    break
            except Exception:
                continue

    result = {
        "ok": True,
        "sourceDir": str(output_dir),
        "image": str(image_path),
        "thumbnail": str(thumbnail_path),
        "video": downloaded_video,
        "videoCandidates": len(capture["videos"]),
        "excludedRecommendations": capture["excludedRecommendations"],
        "recommendationBoundaryFound": capture["recommendationBoundaryFound"],
        "deviceScaleFactor": capture["deviceScaleFactor"],
        "contentWidth": capture["contentWidth"],
        "contentHeight": capture["contentHeight"],
        "imageWidth": image_width,
        "imageHeight": image_height,
        "browserEngine": browser_engine,
    }
    (output_dir / "capture-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
