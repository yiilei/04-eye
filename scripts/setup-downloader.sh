#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
ENGINE_ROOT="$PROJECT_ROOT/vendor/XHS-Downloader"
DISCOVERY_ROOT="$PROJECT_ROOT/vendor/xhs-cli"

retry_network_step() {
  local attempt=1
  while ! "$@"; do
    if (( attempt >= 3 )); then
      return 1
    fi
    echo "网络步骤失败，正在重试（$attempt/3）…" >&2
    sleep $(( attempt * 2 ))
    (( attempt += 1 ))
  done
}

if [[ ! -f "$ENGINE_ROOT/main.py" ]]; then
  mkdir -p "$PROJECT_ROOT/vendor"
  git clone --depth 1 https://github.com/JoeanAmier/XHS-Downloader.git "$ENGINE_ROOT"
fi

if [[ ! -f "$DISCOVERY_ROOT/pyproject.toml" ]]; then
  mkdir -p "$PROJECT_ROOT/vendor"
  git clone --depth 1 https://github.com/jackwener/xhs-cli.git "$DISCOVERY_ROOT"
  rm -rf "$DISCOVERY_ROOT/.git"
fi

if [[ -n "${PYTHON_BIN:-}" ]]; then
  PYTHON_CANDIDATES=("$PYTHON_BIN")
else
  PYTHON_CANDIDATES=(
    "python3.12"
    "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
    "python3"
  )
fi

PYTHON_BIN=""
for candidate in "${PYTHON_CANDIDATES[@]}"; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' 2>/dev/null; then
    PYTHON_BIN="$candidate"
    break
  fi
done
if [[ -z "$PYTHON_BIN" ]]; then
  echo "需要 Python 3.12。使用 Codex 安装时会优先采用它自带的 Python 运行环境。" >&2
  exit 1
fi

"$PYTHON_BIN" -m venv "$ENGINE_ROOT/.venv"
"$ENGINE_ROOT/.venv/bin/python" -m pip install --upgrade pip
# XHS-Downloader's setup.py imports cx_Freeze for its optional desktop build.
# Caiguang runs main.py directly, so install only the declared runtime dependencies.
"$ENGINE_ROOT/.venv/bin/python" -m pip install -r "$ENGINE_ROOT/requirements.txt" "curl-cffi>=0.15.0"
"$ENGINE_ROOT/.venv/bin/python" -c 'import curl_cffi, fastapi, lxml, yaml'

"$PYTHON_BIN" -m venv "$DISCOVERY_ROOT/.venv"
"$DISCOVERY_ROOT/.venv/bin/python" -m pip install --upgrade pip
"$DISCOVERY_ROOT/.venv/bin/python" -m pip install -e "$DISCOVERY_ROOT"
if [[ "${SKIP_CAMOUFOX_FETCH:-0}" != "1" ]]; then
  retry_network_step "$DISCOVERY_ROOT/.venv/bin/python" -m camoufox fetch
fi

echo "小红书发现助手与采集引擎均已安装。"
