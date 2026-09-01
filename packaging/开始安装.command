#!/bin/zsh
set -euo pipefail

package_dir="${0:A:h}"
apps_dir="$HOME/Applications"
target="$apps_dir/采光.app"
staging="$apps_dir/.采光.installing.app"
backup="$apps_dir/.采光.previous.app"

[[ "$(uname -m)" == "arm64" ]] || { echo "当前安装包仅支持 Apple Silicon。"; exit 1; }
[[ -d "$package_dir/采光.app" ]] || { echo "安装包不完整，请完整解压后重试。"; exit 1; }

mkdir -p "$apps_dir"
rm -rf "$staging" "$backup"
ditto "$package_dir/采光.app" "$staging"
codesign --verify --deep --strict "$staging"
osascript -e 'tell application "采光" to quit' >/dev/null 2>&1 || true
[[ -d "$target" ]] && mv "$target" "$backup"
if ! mv "$staging" "$target"; then
  [[ -d "$backup" ]] && mv "$backup" "$target"
  exit 1
fi
open "$target"
rm -rf "$backup"

echo "采光已安装。首次使用请在应用内完成小红书登录和可选的 Eagle 连接。"
