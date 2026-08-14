---
name: xhs-visual-capture
description: Complete local capture of Xiaohongshu notes for the yilei review application. Use when asked to grab, monitor, archive, or verify a Xiaohongshu post, image carousel, video, or Live Photo while minimizing Codex token usage. Runs the deterministic local downloader and validator first; uses browser inspection only when extraction or identity verification fails.
---

# Xiaohongshu Visual Capture

Run from the project root:

```bash
pnpm capture:xhs -- --url '<post-url>' --slug '<stable-id>' --account-name '<name>' --account-id '<id>' --title '<title>'
```

Require one compact JSON line containing `"ok": true`. The command downloads all available images, standalone video, and Live Photo MP4 pairs, writes a manifest, and validates the result before review.

1. Never substitute thumbnails, screenshots, or a partial carousel for full capture.
2. Do not browse each image manually when the command succeeds.
3. On failure, report the short error. Use the signed-in browser only to verify the correct account/post URL or obtain a current link, then retry once.
4. Never copy or persist browser cookies without explicit authorization. Pass a user-supplied cookie only through `--cookie`.
5. Keep source files local. Do not import to Eagle until the user chooses keep.
6. Avoid verbose media descriptions; return counts, validation state, and the local manifest path.
7. Multiple capture commands may be launched together, but this wrapper serializes them with `data/xhs-capture.lock` because the vendored downloader shares one temporary directory.

Read [pipeline.md](references/pipeline.md) for architecture and failure handling.
