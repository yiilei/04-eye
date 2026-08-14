# Pipeline

`URL -> vendored XHS-Downloader -> staging -> normalized review folder -> manifest validator -> pending review`

The pinned engine is in `vendor/XHS-Downloader`; its Python environment is `vendor/XHS-Downloader/.venv`. Captured media is local, so later removal of the source link does not remove the archive.

The validator blocks an item when it finds no media, duplicate image hashes, discontinuous ordering, wrong dimensions, a broken Live Photo/video pair, or a count mismatch.

Use `--source-dir <directory> --output-root <directory>` for an offline fixture test. It runs the same normalization and validation path without network access.
