#!/usr/bin/env python3
"""Capture the activity body at mobile width and archive every observed MP4."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from xhs_cli.auth import cookie_str_to_dict, get_saved_cookie_string
from camoufox.sync_api import Camoufox


NOTES_SELECTORS = (
    ".notes-container",
    ".dual-column-layout",
    "[class*='notes-container']",
)


def valid_mp4(payload: bytes) -> bool:
    return len(payload) >= 1024 and b"ftyp" in payload[:64]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--viewport-width", type=int, default=480)
    parser.add_argument("--output-width", type=int, default=1125)
    args = parser.parse_args()

    cookie = get_saved_cookie_string()
    if not cookie:
        print(json.dumps({"ok": False, "status": "login_required"}, ensure_ascii=False))
        return 1

    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    image_path = output_dir / "full-page-hd.jpg"
    thumbnail_path = output_dir / "thumbnail.png"
    video_path = output_dir / "preview.mp4"

    scale = args.output_width / args.viewport_width
    with Camoufox(headless=True) as browser:
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

        page.wait_for_selector("#app", timeout=20_000)

        # Scroll through the activity body so lazy images/GIF layers are fully rendered.
        for _ in range(3):
            metrics = page.evaluate(
                """(selectors) => {
                  const app = document.querySelector('#app');
                  const notes = selectors.map(s => document.querySelector(s)).find(Boolean);
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

        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(350)
        capture = page.evaluate(
            r"""(selectors) => {
              const app = document.querySelector('#app');
              const notes = selectors.map(s => document.querySelector(s)).find(Boolean);
              if (!app) throw new Error('missing #app');
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
                videos: [...new Set([...videos, ...resources])],
                excludedRecommendations: Boolean(notes),
                deviceScaleFactor: devicePixelRatio,
              };
            }""",
            NOTES_SELECTORS,
        )

        page.screenshot(
            path=str(image_path),
            type="jpeg",
            quality=96,
            full_page=True,
            animations="disabled",
        )
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
        "deviceScaleFactor": capture["deviceScaleFactor"],
        "contentWidth": capture["contentWidth"],
        "contentHeight": capture["contentHeight"],
    }
    (output_dir / "capture-result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
