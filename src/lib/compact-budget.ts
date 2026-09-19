/**
 * compactで一度に畳む発言の量を抑える（#244）。**Prismaも外部モジュールも持ち込まない純粋な関数だけ。**
 *
 * 畳む対象は `summarizedCount` から数えた古い発言で、要約が失敗し続けた相談では溜まった
 * 発言が何十件にもなる。全部を1本のプロンプトへ入れると、モデルの入力が際限なく伸びて
 * 120秒の上限（`compact.ts` の `CODEX_TIMEOUT_MS`）に掛かり、**次の往復でも同じ量を渡して
 * 同じように失敗し続ける。** 1回に畳む量へ上限を置き、入りきらなかったぶんは次の往復へ回す
 * （`summarizedCount` は畳めた件数だけ進むので、残りは続きから畳まれる）。
 */

/** 畳む発言1件の本文の上限（文字）。`MAX_MESSAGE_LENGTH`（利用者の1発言の上限）と揃えてある。 */
export const FOLD_MESSAGE_MAX_CHARS = 8000;

/**
 * 1回に畳む発言の合計の上限（UTF-8のバイト数）。
 *
 * 日本語は1文字3バイトなので、およそ1.6万文字。1件の上限（`FOLD_MESSAGE_MAX_CHARS`）が
 * 24KB以下に収まるので、**先頭の1件は必ずこの中に入る**——入らないまま0件を返すと
 * `summarizedCount` が進まず、同じ発言で畳み続けられなくなる。
 */
export const FOLD_MAX_BYTES = 48 * 1024;

type FoldMessage = { role: "USER" | "ASSISTANT"; content: string };

/** 畳む1件ぶんの文。長すぎる発言は先頭だけを残す。 */
export function foldedLine(message: FoldMessage): string {
  const chars = Array.from(message.content);
  const body =
    chars.length > FOLD_MESSAGE_MAX_CHARS
      ? `${chars.slice(0, FOLD_MESSAGE_MAX_CHARS).join("")}…（長いため以下は省略）`
      : message.content;

  return `${message.role === "USER" ? "利用者" : "秘書"}: ${body}`;
}

/**
 * 古い方から、合計が `FOLD_MAX_BYTES` に収まるところまでの発言を取り出す。
 *
 * 返す `count` は取り出した件数で、呼び出し側はこの数だけ `summarizedCount` を進める。
 * **並びは変えない**（古い方から途切れなく取る）。飛ばして詰めると、畳んだ範囲と履歴の窓の
 * 境目にすき間ができる。
 */
export function selectFoldable(messages: FoldMessage[]): { text: string; count: number } {
  const lines: string[] = [];
  let bytes = 0;

  for (const message of messages) {
    const line = foldedLine(message);
    // 発言と発言のあいだの区切り（空行）ぶんも数える。
    const size = Buffer.byteLength(line, "utf8") + 2;

    if (lines.length > 0 && bytes + size > FOLD_MAX_BYTES) break;

    lines.push(line);
    bytes += size;
  }

  return { text: lines.join("\n\n"), count: lines.length };
}
