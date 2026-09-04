"""Capture a long H5 page as settled viewport slices and stitch them locally."""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageChops, ImageStat


def _seam_score(previous: Image.Image, current: Image.Image, overlap: int) -> float:
    """Return normalized grayscale error for an overlap, excluding fixed edge controls."""
    width = min(previous.width, current.width)
    left = max(0, round(width * 0.08))
    right = max(left + 1, round(width * 0.82))
    previous_strip = previous.crop((left, previous.height - overlap, right, previous.height)).convert("L")
    current_strip = current.crop((left, 0, right, overlap)).convert("L")
    sample_width = min(180, previous_strip.width)
    sample_height = min(120, overlap)
    previous_strip.thumbnail((sample_width, sample_height))
    current_strip.thumbnail((sample_width, sample_height))
    difference = ImageChops.difference(previous_strip, current_strip)
    return ImageStat.Stat(difference).mean[0]


def _best_overlap(previous: Image.Image, current: Image.Image, expected: int) -> tuple[int, float]:
    radius = min(180, max(36, round(expected * 0.45)))
    minimum = max(24, expected - radius)
    maximum = min(previous.height - 1, current.height - 1, expected + radius)
    candidates = range(minimum, maximum + 1, 3)
    overlap, score = min(((value, _seam_score(previous, current, value)) for value in candidates), key=lambda item: item[1])
    return overlap, score


def capture_stitched_page(page, capture: dict, output_path: Path, *, viewport_height: int = 900) -> dict:
    """Capture content in overlapping viewport passes without resizing the browser."""
    content_x = float(capture["contentX"])
    content_y = float(capture["contentY"])
    content_width = float(capture["contentWidth"])
    content_height = float(capture["contentHeight"])
    scale = float(capture["deviceScaleFactor"])
    overlap = min(120, max(48, round(viewport_height * 0.12)))
    step = viewport_height - overlap
    offsets = list(range(0, max(1, int(content_height)), step))
    segments: list[tuple[float, Image.Image]] = []

    page.evaluate(
        """() => {
          const style = document.createElement('style');
          style.dataset.caiguangCaptureFreeze = 'true';
          style.textContent = `
            html { scroll-behavior: auto !important; }
            *, *::before, *::after {
              animation-play-state: paused !important;
              animation-delay: 0s !important;
              transition: none !important;
              caret-color: transparent !important;
            }
          `;
          document.head.appendChild(style);
          for (const video of document.querySelectorAll('video')) video.pause();
        }"""
    )

    for index, offset in enumerate(offsets):
        target_y = content_y + offset
        actual_scroll = page.evaluate(
            """async y => {
              window.scrollTo(0, y);
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const lazyKeys = ['src', 'lazySrc', 'original', 'url'];
              for (const container of document.querySelectorAll('.onix-image[data-src], [data-webp-src]')) {
                const rect = container.getBoundingClientRect();
                if (rect.bottom < -160 || rect.top > innerHeight + 160) continue;
                const source = container.dataset.webpSrc || container.dataset.src;
                const fallback = container.dataset.src || source;
                const image = container.matches('img') ? container : container.querySelector('img');
                if (image && source) {
                  image.src = fallback;
                  image.loading = 'eager';
                  for (const candidate of container.querySelectorAll('source')) candidate.srcset = source;
                }
              }
              for (const image of document.images) {
                const rect = image.getBoundingClientRect();
                if (rect.bottom < -160 || rect.top > innerHeight + 160) continue;
                const lazySource = lazyKeys.map(key => image.dataset[key]).find(Boolean);
                if (lazySource && (!image.currentSrc || image.naturalWidth <= 1 || image.currentSrc.startsWith('data:'))) image.src = lazySource;
                image.loading = 'eager';
              }
              await Promise.all([...document.images].map(async image => {
                const rect = image.getBoundingClientRect();
                if (rect.bottom < -160 || rect.top > innerHeight + 160) return;
                try {
                  if (!image.complete) await new Promise(resolve => {
                    image.addEventListener('load', resolve, { once: true });
                    image.addEventListener('error', resolve, { once: true });
                    setTimeout(resolve, 5000);
                  });
                  if (image.decode && image.naturalWidth > 1) await image.decode().catch(() => {});
                } catch {}
              }));
              return window.scrollY;
            }""",
            target_y,
        )
        page.wait_for_timeout(900)
        viewport_png = page.screenshot(type="png", animations="disabled")
        viewport = Image.open(io.BytesIO(viewport_png)).convert("RGB")
        global_start = max(0.0, float(actual_scroll) - content_y)
        crop_x = max(0, round(content_x * scale))
        crop_y = max(0, round((content_y + global_start - float(actual_scroll)) * scale))
        remaining_css = max(1, content_height - global_start)
        slice_css = min(viewport_height - crop_y / scale, remaining_css)
        crop_width = min(round(content_width * scale), viewport.width - crop_x)
        crop_height = min(round(slice_css * scale), viewport.height - crop_y)
        if crop_width <= 0 or crop_height <= 0:
            raise RuntimeError(f"分屏截图范围无效：第 {index + 1} 段")
        if segments and abs(global_start - segments[-1][0]) < 1:
            continue
        segments.append((global_start, viewport.crop((crop_x, crop_y, crop_x + crop_width, crop_y + crop_height))))

    output_width = min(segment.width for _, segment in segments)
    normalized = [segment.crop((0, 0, output_width, segment.height)) for _, segment in segments]
    overlaps: list[int] = []
    seam_scores: list[float] = []
    for index in range(1, len(normalized)):
        expected = round(max(24, (segments[index - 1][0] + normalized[index - 1].height / scale - segments[index][0]) * scale))
        matched, score = _best_overlap(normalized[index - 1], normalized[index], expected)
        if score > 28:
            raise RuntimeError(f"分屏截图接缝无法可靠对齐：第 {index} 处差异 {score:.1f}")
        overlaps.append(matched)
        seam_scores.append(score)
    output_height = sum(segment.height for segment in normalized) - sum(overlaps)
    stitched = Image.new("RGB", (output_width, output_height))
    cursor = 0
    for index, segment in enumerate(normalized):
        crop_top = overlaps[index - 1] if index else 0
        piece = segment.crop((0, crop_top, output_width, segment.height))
        stitched.paste(piece, (0, cursor))
        cursor += piece.height
    output_path.parent.mkdir(parents=True, exist_ok=True)
    stitched.save(output_path, "JPEG", quality=96, subsampling=0, optimize=True)
    page.evaluate("window.scrollTo(0, 0)")
    return {
        "method": "stitched_viewport_screenshots",
        "segments": len(segments),
        "step": step,
        "overlap": overlap,
        "matchedOverlaps": overlaps,
        "seamScores": seam_scores,
        "width": stitched.width,
        "height": stitched.height,
    }
