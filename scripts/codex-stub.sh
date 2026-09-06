#!/usr/bin/env bash
#
# `codex exec --json` の代わりに、固定の返答を返すだけのスタブ（#205）。
#
# **音声の往復を何度も試すためのもの。** 実物のCodexは1往復に数十秒かかり、ChatGPTの
# サブスクの利用枠（5時間ローリング・週次）を消費するので、聞き取りの開き直しのような
# 「何度も繰り返して確かめたい」検証には向かない。
#
# 使い方（`.env.local` に書く。**コマンドラインで前置きしても効かない**——`.env.local` の方が
# 優先される。CLAUDE.md「worktreeで画面を確認するときの注意」）:
#
#   CODEX_BIN="/home/…/scripts/codex-stub.sh"
#
# 差し替えたら開発サーバーを起こし直すこと。元に戻すときは行ごと消す。
#
# 環境変数で振る舞いを変えられる。
#
#   CODEX_STUB_REPLY       返す本文（既定は下の文）
#   CODEX_STUB_DELAY_MS    返すまでの待ち（既定800ms。実物の間合いを真似たいとき）
#   CODEX_STUB_ARGV_FILE   渡された引数の書き出し先。`-c mcp_servers.…` や
#                          `disabled_tools` が実際に渡っているかを確かめるのに使う
set -euo pipefail

REPLY="${CODEX_STUB_REPLY:-はい、承知しました。これは開発用のスタブが返している固定の返答です。続けて話しかけてみてください。}"
DELAY_MS="${CODEX_STUB_DELAY_MS:-800}"

if [ -n "${CODEX_STUB_ARGV_FILE:-}" ]; then
  printf '%s\n' "$@" >"${CODEX_STUB_ARGV_FILE}"
fi

sleep "$(awk "BEGIN { printf \"%.3f\", ${DELAY_MS} / 1000 }")"

# JSONLの最低限。`item.completed`（本文）と `turn.completed`（使用量）の2行だけあればよい。
# 本文に " や改行が入っても壊れないよう、組み立てはnodeに任せる。
CODEX_STUB_REPLY="${REPLY}" node -e '
const reply = process.env.CODEX_STUB_REPLY;
process.stdout.write(
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: reply } }) + "\n",
);
process.stdout.write(
  JSON.stringify({
    type: "turn.completed",
    usage: { input_tokens: 1200, cached_input_tokens: 800, output_tokens: 40 },
  }) + "\n",
);
'
