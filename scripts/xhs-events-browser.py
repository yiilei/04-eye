#!/usr/bin/env python3
"""Read the creator activity list through the same local xhs-cli browser session."""

from __future__ import annotations

import json
import sys

from xhs_cli.auth import cookie_str_to_dict, get_cookie_string
from xhs_cli.client import XhsClient


EVENTS_URL = "https://creator.xiaohongshu.com/new/events"


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

        default_sort = page.get_by_text("默认排序", exact=True).locator("visible=true")
        if default_sort.count():
            try:
                default_sort.first.click(timeout=3_000)
                page.wait_for_timeout(300)
            except Exception:
                pass
        latest = page.get_by_text("最新排序", exact=True).locator("visible=true")
        if not latest.count():
            latest = page.get_by_text("最新发布", exact=True).locator("visible=true")
        if latest.count():
            try:
                latest.first.click(timeout=3_000)
                page.wait_for_timeout(1_200)
            except Exception:
                pass

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
                  found.push({
                    activityId,
                    sourceUrl: `https://fe.xiaohongshu.com/ditto/vincent/${activityId}?fullscreen=true&naviHidden=yes&source=creator_activity_center`,
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
              for (const item of found) if (!unique.has(item.sourceUrl)) unique.set(item.sourceUrl, item);
              return [...unique.values()];
            }"""
        )
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
