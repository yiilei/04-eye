#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
ENGINE_ROOT="$PROJECT_ROOT/vendor/XHS-Downloader"

if [[ ! -d "$ENGINE_ROOT/.git" ]]; then
  mkdir -p "$PROJECT_ROOT/vendor"
  git clone --depth 1 https://github.com/JoeanAmier/XHS-Downloader.git "$ENGINE_ROOT"
fi

PYTHON_BIN="${PYTHON_BIN:-python3.12}"
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "需要 Python 3.12。请先安装后重新运行。" >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$ENGINE_ROOT/.venv"
"$ENGINE_ROOT/.venv/bin/python" -m pip install --upgrade pip
"$ENGINE_ROOT/.venv/bin/python" -m pip install -e "$ENGINE_ROOT"
echo "小红书采集引擎已安装。"
