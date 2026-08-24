#!/bin/zsh
set -euo pipefail

PACKAGE_DIR="${0:A:h}"
SOURCE_BUNDLE="$PACKAGE_DIR/Codex自动化与源代码"
APP_BUNDLE="$PACKAGE_DIR/采光.app"
DATA_HOME="$HOME/Library/Application Support/采光"
SOURCE_HOME="$DATA_HOME/source"
APP_HOME="$HOME/Applications/采光.app"

[[ "$(uname -m)" == "arm64" ]] || { echo "当前安装包仅支持 Apple Silicon。"; exit 1; }
[[ -d "$SOURCE_BUNDLE" && -d "$APP_BUNDLE" ]] || { echo "安装包不完整，请完整解压后重试。"; exit 1; }

mkdir -p "$HOME/Applications" "$DATA_HOME"
ditto "$APP_BUNDLE" "$APP_HOME"
mkdir -p "$SOURCE_HOME"
ditto "$SOURCE_BUNDLE" "$SOURCE_HOME"

for runtime_dir in \
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin" \
  "$HOME/.cache/codex-runtimes/codex-workspace/dependencies/node/bin" \
  "/opt/homebrew/bin" "/usr/local/bin"; do
  if [[ -x "$runtime_dir/node" ]]; then export PATH="$runtime_dir:$PATH"; break; fi
done
for runtime_dir in \
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback" \
  "$HOME/.cache/codex-runtimes/codex-workspace/dependencies/bin/fallback"; do
  if [[ -x "$runtime_dir/pnpm" ]]; then export PATH="$runtime_dir:$PATH"; break; fi
done

command -v node >/dev/null || { echo "缺少 Node.js 22+，请把本安装包交给 Codex 完成安装。"; exit 1; }
command -v pnpm >/dev/null || { echo "缺少 pnpm，请把本安装包交给 Codex 完成安装。"; exit 1; }

cd "$SOURCE_HOME"
pnpm install --frozen-lockfile
pnpm setup:downloader
plugins/caiguang/scripts/caiguang schedule install
xattr -cr "$APP_HOME"
open "$APP_HOME"

echo
echo "采光已安装。首次使用请在应用内完成小红书登录和可选的 Eagle 连接。"
