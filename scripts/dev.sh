#!/usr/bin/env bash
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

exec next dev -p "${PORT}"
