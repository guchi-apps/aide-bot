import type { ReplyStyle } from "@/lib/chat-model";

/**
 * 書き込みの道具を秘書へ渡すかどうかの設定（#78）。
 *
 * 繋いだサービスの道具には、家計簿への支出登録のように**あとから取り消せない結果が残る**
 * ものがある（AIDEの `aide_zaim_payment` は説明文に「この経路から取り消し・修正はできない」と
 * 書かれている）。#46 では接続1件につき `mcp_toolset` を1つ渡すだけで絞り込みをしておらず、
 * **全ての相談・両方のモードへ書き込みの道具がそのまま渡っていた。**
 *
 * とりわけ危ないのが「話す」で、聞き取った文字列はそのまま発言として送られる。金額や店名の
 * 聞き間違いが取り消せない記録になりうるため、**既定では渡さない**ことにし、渡すかどうかを
 * ここで選べるようにしてある。
 *
 * **#128でCodexへ移ってから#131までは、この設定は何にも効いていなかった**（相談が接続を
 * 読み出していなかった）。#131からはCodexの `disabled_tools` として再び効く。
 *
 * **このモジュールはクライアントコンポーネントからimportする。** Prisma・Anthropic SDK・
 * `next/headers` に触れるものを持ち込まないこと。Cookieの読み出しは
 * `@/lib/mcp/write-tools-server` にある。
 */

export type WriteToolPolicy =
  /** 渡さない。既定。 */
  | "off"
  /** 「書く」のときだけ渡す。声の聞き間違いが記録になるのを防ぐ。 */
  | "text"
  /** どちらのモードでも渡す。 */
  | "on";

export const WRITE_TOOL_POLICY_COOKIE = "aide-bot-mcp-write-tools";

/** 1年。相談のたびに選び直させないため、実質「次に変えるまで」の意味で置く。 */
export const WRITE_TOOL_POLICY_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * 既定は「渡さない」。
 *
 * **設定漏れで書けてしまう側へ倒さない。** 取り消せない書き込みは、使えないことより
 * 意図せず実行されることの方が重い（認証の `ALLOWED_GOOGLE_EMAILS` 未設定を全員拒否に
 * しているのと同じ考え方）。
 */
export const DEFAULT_WRITE_TOOL_POLICY: WriteToolPolicy = "off";

/** 設定の画面に出す順と文言。 */
export const WRITE_TOOL_POLICIES: {
  id: WriteToolPolicy;
  label: string;
  description: string;
}[] = [
  {
    id: "off",
    label: "渡さない",
    description:
      "書き込みの道具を秘書に見せません。頼んでも「設定で許可してください」と返ります。",
  },
  {
    id: "text",
    label: "「書く」のときだけ渡す",
    description:
      "声で頼んだときは渡しません。聞き間違えた金額や店名が、そのまま取り消せない記録になるのを防ぎます。",
  },
  {
    id: "on",
    label: "いつでも渡す",
    description: "話すときも書くときも渡します。秘書は登録の前に内容を復唱して確認します。",
  },
];

/**
 * Cookieの値を設定に均す。
 *
 * 知らない値は既定（渡さない）へ落とす。利用者が書き換えられる値なので、そのまま
 * 判定へ回すと、書き換えるだけで書き込みを開けてしまう。
 */
export function normalizeWriteToolPolicy(value: string | undefined | null): WriteToolPolicy {
  return WRITE_TOOL_POLICIES.some((policy) => policy.id === value)
    ? (value as WriteToolPolicy)
    : DEFAULT_WRITE_TOOL_POLICY;
}

/** この1往復で書き込みの道具を渡すか。 */
export function writeToolsAllowed(policy: WriteToolPolicy, style: ReplyStyle): boolean {
  if (policy === "on") return true;
  if (policy === "text") return style === "text";
  return false;
}
