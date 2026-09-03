#!/usr/bin/env python3
"""Capture an H5 activity and preserve its observable animated asset."""

from __future__ import annotations

import argparse
import base64
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


def dynamic_payload_kind(payload: bytes, content_type: str = "", url: str = "") -> str | None:
    """Return a browser-renderable animation kind, never classify static WebP."""
    content_type = content_type.lower().split(";", 1)[0].strip()
    suffix = url.lower().split("?", 1)[0]
    if valid_mp4(payload):
        return "mp4"
    if len(payload) >= 1024 and payload[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if len(payload) >= 1024 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP" and b"ANIM" in payload[:4096]:
        return "webp"
    if len(payload) >= 1024 and payload[:4] == b"\x1aE\xdf\xa3" and (content_type == "video/webm" or suffix.endswith(".webm")):
        return "webm"
    return None


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
    observed_dynamic: dict[str, str] = {}

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
        def observe_response(response) -> None:
            content_type = response.headers.get("content-type", "").lower()
            url = response.url
            if any(token in content_type for token in ("video/", "image/gif", "image/webp", "mpegurl")) \
                    or any(token in url.lower().split("?", 1)[0] for token in (".mp4", ".webm", ".gif", ".webp", ".m3u8")):
                observed_dynamic[url] = content_type
        page.on("response", observe_response)
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
                .filter(entry => entry.initiatorType === 'video' || /\.(?:mp4|webm|gif|webp|m3u8)(?:\?|$)/i.test(entry.name))
                .map(entry => entry.name);
              const imageResources = [...document.images]
                .map(image => image.currentSrc || image.src)
                .filter(source => /\.(?:gif|webp)(?:\?|$)/i.test(source));
              const canvasCount = document.querySelectorAll('canvas').length;
              for (const element of document.querySelectorAll('.template-h5-mask')) element.style.display = 'none';
              if (notes) notes.style.display = 'none';
              // Swiper renders carousel cards on separate 3D compositor layers.
              // Those layers may disappear when Chrome captures beyond the
              // viewport, leaving a large white block in an otherwise valid
              // activity archive. Flatten only the currently visible slide
              // for the static long image; the original animation file is
              // still preserved separately.
              for (const swiper of document.querySelectorAll('.swiper')) {
                const active = swiper.querySelector('.swiper-slide-active')
                  || swiper.querySelector('.swiper-slide:not(.swiper-slide-duplicate)')
                  || swiper.querySelector('.swiper-slide');
                if (!active) continue;
                const wrapper = swiper.querySelector('.swiper-wrapper');
                if (wrapper) wrapper.style.setProperty('transform', 'none', 'important');
                for (const slide of swiper.querySelectorAll('.swiper-slide')) {
                  const visible = slide === active;
                  slide.style.setProperty('visibility', visible ? 'visible' : 'hidden', 'important');
                  slide.style.setProperty('opacity', visible ? '1' : '0', 'important');
                  slide.style.setProperty('transform', 'none', 'important');
                  if (visible) {
                    slide.style.setProperty('position', 'absolute', 'important');
                    slide.style.setProperty('inset', '0', 'important');
                    for (const image of slide.querySelectorAll('img')) {
                      const lazySource = image.dataset.src || image.dataset.lazySrc;
                      if (lazySource && !image.currentSrc) image.src = lazySource;
                      image.style.setProperty('visibility', 'visible', 'important');
                      image.style.setProperty('opacity', '1', 'important');
                    }
                  }
                }
              }
              document.documentElement.style.width = `${appRect.width}px`;
              document.body.style.width = `${appRect.width}px`;
              document.body.style.margin = '0';
              return {
                contentWidth: appRect.width,
                contentHeight: Math.max(1, end),
                contentX: Math.max(0, appRect.left),
                contentY: Math.max(0, appRect.top),
                dynamicUrls: [...new Set([...videos, ...resources, ...imageResources])],
                canvasCount,
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
        capture["canvasAnimated"] = page.evaluate(
            """async () => {
              const canvases = [...document.querySelectorAll('canvas')];
              const snapshot = () => canvases.map(canvas => {
                try { return canvas.toDataURL('image/png').slice(-4096); }
                catch { return `tainted:${canvas.width}x${canvas.height}`; }
              }).join('|');
              const before = snapshot();
              await new Promise(resolve => setTimeout(resolve, 350));
              return Boolean(canvases.length && before !== snapshot());
            }"""
        )

        # Keep the mobile viewport stable while capturing beyond it. Some H5
        # campaigns derive spacer and carousel geometry from `innerHeight`;
        # growing the viewport to the full document height creates large blank
        # regions and can make sections render twice.
        clip = {
            "x": capture["contentX"],
            "y": capture["contentY"],
            "width": capture["contentWidth"],
            "height": capture["contentHeight"],
        }
        if browser_engine == "system_chrome":
            cdp = context.new_cdp_session(page)
            encoded = cdp.send("Page.captureScreenshot", {
                "format": "jpeg",
                "quality": 96,
                "fromSurface": True,
                "captureBeyondViewport": True,
                "clip": {**clip, "scale": capture["deviceScaleFactor"]},
            })["data"]
            image_bytes = base64.b64decode(encoded)
        else:
            required_viewport_height = max(900, math.ceil(capture["contentY"] + capture["contentHeight"]) + 2)
            page.set_viewport_size({"width": args.viewport_width, "height": required_viewport_height})
            page.wait_for_timeout(350)
            image_bytes = page.screenshot(type="jpeg", quality=96, clip=clip, animations="disabled")
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

        downloaded_animation = None
        candidates = dict(observed_dynamic)
        for candidate_url in capture["dynamicUrls"]:
            candidates.setdefault(candidate_url, "")
        hls_candidates = [url for url, content_type in candidates.items()
                          if "mpegurl" in content_type or url.lower().split("?", 1)[0].endswith(".m3u8")]
        strong_candidates = [url for url, content_type in candidates.items()
                             if any(token in content_type for token in ("video/", "image/gif", "mpegurl"))
                             or any(url.lower().split("?", 1)[0].endswith(suffix)
                                    for suffix in (".mp4", ".webm", ".gif", ".m3u8"))]
        for media_url, content_type in candidates.items():
            try:
                if media_url in hls_candidates:
                    continue
                response = page.context.request.get(media_url, headers={"Referer": page.url}, timeout=30_000)
                body = response.body()
                kind = dynamic_payload_kind(body, response.headers.get("content-type", content_type), media_url)
                if response.ok and kind:
                    animation_path = video_path if kind == "mp4" else output_dir / f"animation.{kind}"
                    animation_path.write_bytes(body)
                    downloaded_animation = {
                        "url": media_url,
                        "kind": kind,
                        "filename": animation_path.name,
                        "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(),
                    }
                    break
            except Exception:
                continue

        if not downloaded_animation and (strong_candidates or capture["canvasAnimated"]):
            unresolved = "HLS 流" if hls_candidates else "Canvas 动效" if capture["canvasAnimated"] else "动态资源"
            raise RuntimeError(f"检测到{unresolved}，但当前页面没有可验证的原始动画文件；已阻止误登记为静态素材")

    result = {
        "ok": True,
        "sourceDir": str(output_dir),
        "image": str(image_path),
        "thumbnail": str(thumbnail_path),
        "video": downloaded_animation if downloaded_animation and downloaded_animation["kind"] == "mp4" else None,
        "animation": downloaded_animation,
        "videoCandidates": len(strong_candidates),
        "dynamicCandidates": 1 if downloaded_animation else len(strong_candidates) + int(capture["canvasAnimated"]),
        "canvasCount": capture["canvasCount"],
        "canvasAnimated": capture["canvasAnimated"],
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
