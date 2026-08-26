/**
 * 書き込みの道具を使った記録の扱い（#81）。
 *
 * #78 で「取り消せない書き込みを既定で渡さない」ようにしたが、渡したときに**何を登録したのかが
 * aide-bot 側に残らない**という懸念（#78の3番目）はそのままだった。ツールの呼び出しと結果を
 * 発言として保存しない方針（#46）は変えられないため、`Message` とは別の `ToolCall` へ残し、
 * 相談の画面にはそこから並べる。
 *
 * **このモジュールはクライアントコンポーネントからimportする。** Prisma・Anthropic SDK・
 * `next/headers` に触れるものを持ち込まないこと（返答のモデル #71・書き込みの道具 #78 と
 * 同じ分け方）。
 */

/**
 * 保存する引数の上限。
 *
 * 引数は「何を登録したのか」そのものなので広めに取るが、青天井にはしない。列はTEXT
 * （MariaDBで64KB）なので、極端に長い引数をそのまま入れると書き込みごと失敗する
 * ——記録できないことより、記録の失敗が目立つことの方が困る。
 */
export const TOOL_CALL_INPUT_LIMIT = 4000;

/** 保存する結果の上限。結果は控えなので引数より短くてよい。 */
export const TOOL_CALL_OUTPUT_LIMIT = 2000;

/** 上限を超えたぶんを落とす。落としたことが分かるよう印を付ける。 */
export function truncateToolText(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** 画面に並べる「キー: 値」1組。 */
export type ToolCallField = { key: string; value: string };

/**
 * 保存してある引数のJSONを、画面に並べられる形へ均す。
 *
 * **JSONとして読めなかったものを捨てない。** 途中で切れた引数・オブジェクトでない引数でも
 * 「何を渡したのか」は残っている唯一の手掛かりなので、そのまま1行として出す。
 */
export function toolCallFields(input: string): ToolCallField[] {
  const raw = input.trim();
  if (raw === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ key: "内容", value: raw }];
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return [{ key: "内容", value: raw }];
  }

  return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => ({
    key,
    value:
      typeof value === "string"
        ? value
        : value === null || value === undefined
          ? "—"
          : typeof value === "object"
            ? JSON.stringify(value)
            : String(value),
  }));
}
