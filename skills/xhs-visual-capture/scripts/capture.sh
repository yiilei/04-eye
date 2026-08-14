#!/bin/sh
set -eu
PROJECT_ROOT="${XHS_CAPTURE_PROJECT:-$(pwd)}"
exec "$PROJECT_ROOT/vendor/XHS-Downloader/.venv/bin/python" "$PROJECT_ROOT/scripts/xhs-capture.py" "$@"
