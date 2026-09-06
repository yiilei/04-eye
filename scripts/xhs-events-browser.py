#!/usr/bin/env python3
"""Read the creator activity list through the same local xhs-cli browser session."""

from __future__ import annotations

import json
import sys
import time
from urllib.parse import urlparse

from xhs_cli.auth import cookie_str_to_dict, get_cookie_string
from xhs_cli.client import XhsClient


EVENTS_URL = "https://creator.xiaohongshu.com/new/events"


def select_latest(page):
    page.locator(".card-box[data-impression]").first.wait_for(timeout=10_000)
    default_sort = page.get_by_text("默认排序", exact=True).locator("visible=true")
    if default_sort.count():
        default_sort.first.click(timeout=3_000)
        latest = page.get_by_text("最新排序", exact=True).locator("visible=true")
        if not latest.count():
            latest = page.get_by_text("最新发布", exact=True).locator("visible=true")
        latest.first.click(timeout=3_000)
        page.wait_for_timeout(1_200)


def verified_detail_url(url, activity_id):
    """Only accept an observed HTTPS detail route for this exact activity."""
    parsed = urlparse(url or "")
    return (parsed.scheme == "https" and parsed.hostname == "fe.xiaohongshu.com"
            and parsed.path.rstrip("/").split("/")[-1] == activity_id
            and "/vincent/" in parsed.path)


def resolve_detail(page, event):
    activity_id = event.get("activityId", "")
    if not activity_id:
        return
    # Locate by ID, never by title: unrelated activities can share a name.
    cards = page.locator(".card-box[data-impression]")
    card = None
    for index in range(cards.count()):
        candidate = cards.nth(index)
        try:
            data = json.loads(candidate.get_attribute("data-impression") or "{}")
            if str(data.get("activityTarget", {}).get("value", {}).get("activityId", "")) == activity_id:
                card = candidate
                break
        except (ValueError, TypeError):
            continue
    if card is None:
        raise RuntimeError("未找到对应活动卡片")
    before_pages = list(page.context.pages)
    try:
        card.get_by_text("查看详情", exact=True).click(timeout=3_000)
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            candidates = [(page.url, "navigation")]
            candidates += [(frame.url, "iframe") for frame in page.frames]
            candidates += [(url, "iframe-src") for url in page.locator("iframe").evaluate_all("els => els.map(el => el.src)")]
            candidates += [(popup.url, "popup") for popup in page.context.pages if popup not in before_pages]
            for url, evidence in candidates:
                if verified_detail_url(url, activity_id):
                    event.update(sourceUrl=url, detailResolution="resolved", detailEvidence=evidence)
                    return
            page.wait_for_timeout(200)
        raise RuntimeError("详情已打开，但未取得与活动编号匹配的正文地址")
    finally:
        for popup in page.context.pages:
            if popup not in before_pages:
                popup.close()
        # Reload also closes drawers that leave the parent URL unchanged.
        page.goto(EVENTS_URL, wait_until="domcontentloaded", timeout=15_000)
        select_latest(page)


def main() -> int:
    cookie = get_cookie_string()
    if not cookie:
        print(json.dumps({"ok": False, "status": "login_required"}, ensure_ascii=False))
        return 1

    with XhsClient(cookie_str_to_dict(cookie)) as client:
        page = client._page
        page.goto(EVENTS_URL, wait_until="domcontentloaded", timeout=30_000)
        page.wait_for_timeout(2_000)
        if "/login" in page.url or "登录" in page.title():
            print(json.dumps({"ok": False, "status": "creator_login_required", "url": page.url}, ensure_ascii=False))
            return 1

        select_latest(page)

        events = page.evaluate(
            """() => {
              const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
              const found = [];
              const push = (url, title, cover = '') => {
                if (!url || !/(fe\\.xiaohongshu\\.com|\\/ditto\\/|\\/events?\\/detail)/i.test(url)) return;
                found.push({ sourceUrl: new URL(url, location.href).href, title: clean(title) || '小红书创作活动', coverUrl: cover || '' });
              };
              for (const card of document.querySelectorAll('.card-box[data-impression]')) {
                try {
                  const impression = JSON.parse(card.getAttribute('data-impression') || '{}');
                  const activityId = impression?.activityTarget?.value?.activityId || '';
                  if (!activityId) continue;
                  const title = clean(card.querySelector('.title')?.textContent);
                  const image = card.querySelector(':scope > img');
                  const detail = card.querySelector('a[href*="barleypromotion"], a[href*="ditto"], [data-url*="barleypromotion"], [data-href*="barleypromotion"]');
                  found.push({
                    activityId,
                    sourceUrl: detail ? new URL(detail.href || detail.dataset?.url || detail.dataset?.href, location.href).href
                      : location.href,
                    detailResolution: 'unresolved',
                    title: title || '小红书创作活动',
                    description: clean(card.querySelector('.desc')?.textContent),
                    displayDate: clean(card.querySelector('.time')?.textContent),
                    coverUrl: image?.currentSrc || image?.src || '',
                  });
                } catch (_) {}
              }
              for (const element of document.querySelectorAll('a[href], [data-href], [data-url]')) {
                const url = element.href || element.dataset?.href || element.dataset?.url || '';
                const card = element.closest('[class*=card], [class*=item], li') || element;
                const image = card.querySelector?.('img');
                push(url, card.innerText || element.getAttribute('aria-label') || image?.alt, image?.currentSrc || image?.src);
              }
              const seenObjects = new WeakSet();
              const walk = (value, depth = 0) => {
                if (!value || typeof value !== 'object' || depth > 7 || seenObjects.has(value)) return;
                seenObjects.add(value);
                if (!Array.isArray(value)) {
                  const url = value.url || value.link || value.jumpUrl || value.jump_url || value.h5Url || value.h5_url || '';
                  const title = value.title || value.name || value.activityName || value.activity_name || '';
                  const cover = value.cover || value.coverUrl || value.cover_url || value.image || '';
                  if (typeof url === 'string') push(url, title, cover);
                }
                for (const child of Object.values(value)) walk(child, depth + 1);
              };
              try { walk(window.__INITIAL_STATE__); } catch (_) {}
              const unique = new Map();
              for (const item of found) {
                const key = item.activityId || item.sourceUrl;
                if (!unique.has(key) || /barleypromotion/i.test(item.sourceUrl)) unique.set(key, item);
              }
              return [...unique.values()];
            }"""
        )

        # Many creator-center builds expose the detail route only after the
        # card's “查看详情” action is clicked. Resolve those routes while the
        # authenticated browser session is still alive, then return to the list.
        resolution_deadline = time.monotonic() + 65
        for event in events:
            if time.monotonic() >= resolution_deadline:
                event.setdefault("detailError", "本轮详情解析已达到时间上限，将在后续抓取重试")
                continue
            try:
                resolve_detail(page, event)
            except Exception as error:
                event["detailError"] = str(error).split("\n")[0]
        diagnostics = page.evaluate(
            """() => {
              const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
              return ({
              title: document.title,
              bodyText: String(document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 500),
              anchorCount: document.querySelectorAll('a[href]').length,
              initialKeys: Object.keys(window.__INITIAL_STATE__ || {}).slice(0, 40),
              });
            }"""
        )
        print(json.dumps({"ok": True, "status": "verified", "url": page.url, "events": events, "diagnostics": diagnostics}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
