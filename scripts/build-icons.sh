#!/usr/bin/env bash
#
# public/icon.svg から、PWA用のPNGとファビコン(.ico)を書き出す。
#
# アイコンの正は public/icon.svg の1枚だけ。ここで書き出したPNG・icoはその写しなので、
# 絵を直すときはSVGだけを直してこのスクリプトを流し、生成物ごとコミットする
# （PNGを直接編集すると、次にこれを流した時点で戻る）。
#
# 生成物はコミットするため、CI・本番ではこのスクリプトも下のコマンドも要らない。
# 実行に必要なもの:
#   sudo apt install librsvg2-bin imagemagick
#
set -euo pipefail

cd "$(dirname "$0")/.."

src="public/icon.svg"
[ -f "$src" ] || { echo "$src が見つかりません" >&2; exit 1; }

for cmd in rsvg-convert convert; do
  command -v "$cmd" >/dev/null || {
    echo "$cmd がありません。sudo apt install librsvg2-bin imagemagick" >&2
    exit 1
  }
done

render() { # render <サイズ> <出力先>
  rsvg-convert --width "$1" --height "$1" --output "$2" "$src"
  echo "  $2 (${1}x${1})"
}

echo "PWA用のPNGを書き出します"
render 192 public/icon-192.png
render 512 public/icon-512.png
# iOSのホーム画面用。180pxがApple指定のサイズ。
render 180 public/apple-icon.png

echo "ファビコンを書き出します"
# .ico は複数サイズを1ファイルに束ねる。ブラウザはタブに16、ブックマーク等に32を使う。
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for size in 16 32 48; do
  rsvg-convert --width "$size" --height "$size" --output "$tmp/$size.png" "$src"
done
convert "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" src/app/favicon.ico
echo "  src/app/favicon.ico (16/32/48)"

echo "完了しました。生成物もコミットしてください。"
