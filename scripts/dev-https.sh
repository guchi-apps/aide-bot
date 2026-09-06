#!/usr/bin/env bash
#
# 開発サーバーをtailnetへ **HTTPSで** 公開する（#205）。
#
# **iPhoneの実機で「話す」を試すにはこれが要る。** マイク（`getUserMedia`）も
# Web Speech APIも secure context 限定なので、平文のHTTPで開いた画面ではマイクが
# そもそも開かない。ホーム画面への追加（PWA・standalone）もHTTPSでないとできず、
# #155・#164・#179・#197 で追ってきた症状は**ホーム画面のPWAでしか再現しない。**
#
# 使い方（`pnpm dev` を起こしたまま、別のシェルで1回だけ実行する）:
#
#   pnpm dev:https
#
# 出てきたURLをiPhoneのSafariで開き、共有 → ホーム画面に追加。以後はそのアイコンから
# 開けば、本番へデプロイせずに手元の変更をPWAとして試せる。
#
# **HTTPSのポートは開発サーバーのポート＋10000にしてある。** 同じポートへ張ると、
# tailscaledと `next dev` が同じポートを取り合って `EADDRINUSE` で開発サーバーが
# 起動しなくなる（実測）。issueごとに割り当てられる24xxx番台とも重ならない。
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# next devは.env.localを自動読込するが、このスクリプト自身（bash）は読み込まないため明示的に読む。
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

PORT="${PORT:-3000}"
HTTPS_PORT="${DEV_HTTPS_PORT:-$((PORT + 10000))}"

# 解除。`pnpm dev:https off` で呼べる。
if [ "${1:-}" = "off" ]; then
  tailscale serve --https="${HTTPS_PORT}" off
  echo "https://<ホスト>.ts.net:${HTTPS_PORT} の公開をやめました。"
  exit 0
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "tailscale が見つかりません。このホストからは実機での確認ができません。" >&2
  exit 1
fi

# Tailnet HTTPS証明書が有効になっていないと `tailscale serve --https` は張れない。
# 有効化は管理画面での操作（エージェントは代行できない）。
if [ "$(tailscale status --json | jq -r '.CertDomains // [] | length')" = "0" ]; then
  echo "Tailnet HTTPS証明書が有効になっていません（tailscale status --json の CertDomains が空）。" >&2
  echo "Tailscaleの管理画面 → DNS → HTTPS Certificates を有効にしてから、もう一度実行してください。" >&2
  exit 1
fi

HOSTNAME_TS="$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')"

# 開発サーバーが上がっていないと、iPhoneで開いても502になるだけ。先に知らせる。
if ! curl -sS -o /dev/null --max-time 3 "http://127.0.0.1:${PORT}/"; then
  echo "http://127.0.0.1:${PORT}/ へ届きません。先に別のシェルで pnpm dev を起こしてください。" >&2
  exit 1
fi

tailscale serve --bg --https="${HTTPS_PORT}" "http://127.0.0.1:${PORT}" >/dev/null

URL="https://${HOSTNAME_TS}:${HTTPS_PORT}/"

cat <<EOF

iPhoneからは次のURLで開けます（Tailscaleに繋がっている必要があります）。

  ${URL}

  1. Safariで開く
  2. 「開発用ダミーユーザーでログイン」を押す（pnpm db:seed:dev を先に流しておく）
  3. 共有 → ホーム画面に追加。以後はそのアイコンから開くとPWA（standalone）になる

公開をやめるときは次を実行します。

  pnpm dev:https off

EOF
