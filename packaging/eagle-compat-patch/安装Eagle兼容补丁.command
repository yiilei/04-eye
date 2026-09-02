#!/bin/zsh
set -euo pipefail

package_dir="${0:A:h}"
payload="$package_dir/app"
target="${CAIGUANG_APP_TARGET:-$HOME/Applications/采光.app}"
resources="$target/Contents/Resources"
current="$resources/app"
staging="${target}.eagle-compat-payload"
backup="${target}.before-eagle-compat-payload"

[[ -d "$target" ]] || { echo "未找到采光，请先安装采光 v0.3.28。"; exit 1; }
[[ -d "$payload" ]] || { echo "补丁不完整，请完整解压后重试。"; exit 1; }
version="$(/usr/bin/defaults read "$target/Contents/Info" CFBundleShortVersionString 2>/dev/null || true)"
[[ "$version" == "0.3.28" ]] || { echo "本补丁仅适用于采光 v0.3.28，当前版本：${version:-未知}。"; exit 1; }

/usr/bin/osascript -e 'tell application "采光" to quit' >/dev/null 2>&1 || true
/usr/bin/pkill -f "$target" >/dev/null 2>&1 || true
/bin/rm -rf "$staging" "$backup"
/usr/bin/ditto "$payload" "$staging"
/bin/mv "$current" "$backup"
if ! /bin/mv "$staging" "$current"; then
  /bin/mv "$backup" "$current"
  exit 1
fi
/usr/bin/xattr -cr "$target"
/usr/bin/codesign --remove-signature "$target" >/dev/null 2>&1 || true
# v0.3.28 contains a large symlinked runtime. Deep re-signing rewrites those
# already-valid nested signatures, so only reseal the outer app bundle and then
# verify the complete nested chain.
if ! /usr/bin/codesign --force --sign - "$target" || ! /usr/bin/codesign --verify --deep --strict "$target"; then
  /bin/rm -rf "$current"
  /bin/mv "$backup" "$current"
  /usr/bin/codesign --force --sign - "$target" >/dev/null 2>&1 || true
  echo "补丁安装失败，已恢复原版。"
  exit 1
fi
/bin/rm -rf "$backup"
[[ "${CAIGUANG_PATCH_NO_OPEN:-0}" == "1" ]] || /usr/bin/open "$target"
echo "采光 v0.3.28 Eagle 兼容补丁已安装。"
