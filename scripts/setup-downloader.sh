#!/bin/zsh
set -euo pipefail

PROJECT_ROOT="${0:A:h:h}"
ENGINE_ROOT="$PROJECT_ROOT/vendor/XHS-Downloader"
DISCOVERY_ROOT="$PROJECT_ROOT/vendor/xhs-cli"
SETUP_STATE_DIR="$PROJECT_ROOT/.caiguang-setup"
SETUP_SCHEMA="3"

mkdir -p "$SETUP_STATE_DIR"

started_at="$(date +%s)"

log_step() {
  echo "[$1] $2"
}

fingerprint() {
  {
    print -r -- "$SETUP_SCHEMA"
    print -r -- "$PYTHON_VERSION"
    for source_file in "$@"; do
      [[ -f "$source_file" ]] && cat "$source_file"
    done
  } | shasum -a 256 | awk '{print $1}'
}

stamp_matches() {
  local stamp_file="$1"
  local expected="$2"
  [[ -f "$stamp_file" && "$(<"$stamp_file")" == "$expected" ]]
}

write_stamp() {
  print -r -- "$2" > "$1"
}

venv_portable() {
  local venv_bin="$1"
  local script="$2"
  local script_path="$venv_bin/$script"
  [[ -x "$script_path" ]] || return 1
  local shebang
  shebang="$(head -1 "$script_path" 2>/dev/null)"
  [[ "$shebang" == "#!$venv_bin/python" || "$shebang" == "#!$venv_bin/python3" ]]
}

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

PYTHON_VERSION="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')"
ENGINE_STAMP="$SETUP_STATE_DIR/downloader.sha256"
DISCOVERY_STAMP="$SETUP_STATE_DIR/xhs-cli.sha256"
ENGINE_FINGERPRINT="$(fingerprint "$ENGINE_ROOT/requirements.txt")"
DISCOVERY_FINGERPRINT="$(fingerprint "$DISCOVERY_ROOT/pyproject.toml" "$DISCOVERY_ROOT/uv.lock")"

engine_ready=0
if [[ "${FORCE_SETUP:-0}" != "1" ]] && stamp_matches "$ENGINE_STAMP" "$ENGINE_FINGERPRINT"; then
  if venv_portable "$ENGINE_ROOT/.venv/bin" "pip3" && "$ENGINE_ROOT/.venv/bin/python" -c 'import curl_cffi, fastapi, lxml, yaml' 2>/dev/null; then
    engine_ready=1
  fi
fi

discovery_ready=0
if [[ "${FORCE_SETUP:-0}" != "1" ]] && stamp_matches "$DISCOVERY_STAMP" "$DISCOVERY_FINGERPRINT"; then
  if venv_portable "$DISCOVERY_ROOT/.venv/bin" "xhs" && "$DISCOVERY_ROOT/.venv/bin/python" -c 'import camoufox, xhs_cli' 2>/dev/null; then
    discovery_ready=1
  fi
fi

engine_pid=""
discovery_pid=""

if (( engine_ready )); then
  log_step "1/3" "媒体下载依赖未变化，跳过安装。"
else
  log_step "1/3" "安装媒体下载依赖…"
  (
    "$PYTHON_BIN" -m venv "$ENGINE_ROOT/.venv"
    "$ENGINE_ROOT/.venv/bin/python" -m pip install --disable-pip-version-check --no-input \
      -r "$ENGINE_ROOT/requirements.txt" "curl-cffi>=0.15.0"
    "$ENGINE_ROOT/.venv/bin/python" -c 'import curl_cffi, fastapi, lxml, yaml'
    write_stamp "$ENGINE_STAMP" "$ENGINE_FINGERPRINT"
  ) > "$SETUP_STATE_DIR/downloader.log" 2>&1 &
  engine_pid=$!
fi

if (( discovery_ready )); then
  log_step "2/3" "账号发现依赖未变化，跳过安装。"
else
  log_step "2/3" "安装账号发现依赖…"
  (
    "$PYTHON_BIN" -m venv "$DISCOVERY_ROOT/.venv"
    "$DISCOVERY_ROOT/.venv/bin/python" -m pip install --disable-pip-version-check --no-input -e "$DISCOVERY_ROOT"
    "$DISCOVERY_ROOT/.venv/bin/python" -c 'import camoufox, xhs_cli'
    write_stamp "$DISCOVERY_STAMP" "$DISCOVERY_FINGERPRINT"
  ) > "$SETUP_STATE_DIR/xhs-cli.log" 2>&1 &
  discovery_pid=$!
fi

install_failed=0
if [[ -n "$engine_pid" ]] && ! wait "$engine_pid"; then
  echo "媒体下载依赖安装失败：" >&2
  tail -n 80 "$SETUP_STATE_DIR/downloader.log" >&2
  install_failed=1
fi
if [[ -n "$discovery_pid" ]] && ! wait "$discovery_pid"; then
  echo "账号发现依赖安装失败：" >&2
  tail -n 80 "$SETUP_STATE_DIR/xhs-cli.log" >&2
  install_failed=1
fi
(( install_failed == 0 )) || exit 1

if [[ "${SKIP_CAMOUFOX_FETCH:-0}" != "1" ]]; then
  CAMOUFOX_LIST="$("$DISCOVERY_ROOT/.venv/bin/python" -m camoufox list --path 2>/dev/null || true)"
  if [[ "${FORCE_CAMOUFOX_FETCH:-0}" != "1" && "$CAMOUFOX_LIST" == *"(active)"* ]]; then
    log_step "3/3" "Camoufox 浏览器已缓存，跳过下载。"
  else
    log_step "3/3" "首次下载 Camoufox 浏览器（文件较大，只执行一次）…"
    retry_network_step "$DISCOVERY_ROOT/.venv/bin/python" -m camoufox fetch
  fi
else
  log_step "3/3" "已按配置跳过 Camoufox 下载。"
fi

elapsed=$(( $(date +%s) - started_at ))
echo "小红书发现助手与采集引擎均已就绪（${elapsed} 秒）。"
