/**
 * 相談（チャット）の返答生成に使うモデル（#128）。
 *
 * **このモジュールはクライアントコンポーネントからもimportする。** 設定の画面がモデルを
 * 選ぶため、PrismaやCodex CLIの起動処理に触れるものをここへ持ち込まないこと
 * （`src/lib/usage.ts` や `src/lib/app-version.ts` をサーバー専用に保っているのと同じ理由で、
 * 引き込んだものがそのままクライアントバンドルへ入る）。
 *
 * Cookieの読み書きもここには置かない。`next/headers` はサーバー専用で、import した時点で
 * クライアント側のビルドが落ちる（読み出しは `src/lib/chat-model-server.ts`）。
 */

/** 返答をどう受け取るか。体裁の指示と上限トークンがこれで変わる（#27）。 */
export type ReplyStyle = "text" | "voice";

/**
 * 朝の見通し（#79）を書くモデル。**Anthropic（Claude）のまま。**
 *
 * #128でチャット（書く・話す）の返答生成はCodexへ移したが、朝の見通し・お知らせ選定
 * （`NOTICE_MODEL`）は対象外としてClaudeのまま残してある（段階移行。詳細はIssueの計画を参照）。
 * 設定の画面からは選べない——選ぶ主体が居ない場面（cronから叩かれる）で使うため、
 * Cookieを読めない。
 */
export const BRIEFING_MODEL = "claude-haiku-4-5";

/**
 * 吹き出しに出すお知らせを1件選ぶモデル（#93）。**Anthropic（Claude）のまま**（`BRIEFING_MODEL`と同じ理由）。
 */
export const NOTICE_MODEL = "claude-haiku-4-5";

/**
 * `/usage` 画面の単価表。**Anthropic（Claude）の単価のまま。**
 *
 * チャット（書く・話す）はCodexへ移り、ChatGPTのサブスク定額制で動くためトークン単価の
 * 概念に合わない（#128でチャット分の `ApiUsage` 記録自体をやめた）。朝の見通し・お知らせ選定は
 * 引き続きClaudeを呼ぶため、この表はそのまま残す。
 *
 * 出典: https://claude.com/pricing#api（2026-08-25 時点）
 */
export type ModelPricing = {
  input: number;
  output: number;
  /** プロンプトキャッシュへの書き込み（TTL 5分）。 */
  cacheWrite: number;
  /** プロンプトキャッシュからの読み出し。 */
  cacheRead: number;
};

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export type ChatModelId = "gpt-5.6-sol" | "gpt-5.6-terra" | "gpt-5.6-luna";

export type ChatModelOption = {
  id: ChatModelId;
  /** 画面に出す名前。 */
  label: string;
  /** 画面に出す一言。 */
  hint: string;
};

/**
 * 選べるモデル（Codex CLIが提供するGPT-5.6系。賢い順に並べる。画面の並びもこの順）。
 *
 * Sol＝旗艦（いちばん賢い）、Terra＝GPT-5.5相当の中位、Luna＝いちばん速く安いモデル
 * （出典: https://openai.com/index/gpt-5-6/）。サブスクの利用枠（5時間ローリング＋週次）は
 * モデルが重いほど早く減るため、既定は「話す」をLuna・「書く」をSolに割り当てる。
 */
export const CHAT_MODELS: ChatModelOption[] = [
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "いちばん賢い" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "中間" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "いちばん速い" },
];

/**
 * 何も選んでいないときのモデル。
 *
 * 既定を変えると、設定を触っていない端末の返答が黙って変わるので、変えるときは画面の案内も
 * 一緒に見直す。
 */
export const DEFAULT_CHAT_MODEL: ChatModelId = "gpt-5.6-sol";

/**
 * 選んだモデルを置くCookie（`aide-bot-talk-mode` と同じ考え方）。
 *
 * localStorageではなくCookieなのは、**サーバー側でも同じ値を読む必要がある**ため。
 * 返答を生成するのは `/api/chat`（Route Handler）。
 */
export const CHAT_MODEL_COOKIE: Record<ReplyStyle, string> = {
  text: "aide-bot-chat-model-text",
  voice: "aide-bot-chat-model-voice",
};

/** 1年。相談のたびに選び直させないため、実質「次に変えるまで」の意味で置く。 */
export const CHAT_MODEL_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Cookieの値をモデル名に均す。
 *
 * 知らない値は既定へ落とす。利用者が書き換えられる値なので、そのまま渡すと存在しないモデル名で
 * `codex exec` が失敗し、相談そのものが通らなくなる。
 */
export function normalizeChatModel(value: string | undefined | null): ChatModelId {
  const known = CHAT_MODELS.find((model) => model.id === value);
  return known ? known.id : DEFAULT_CHAT_MODEL;
}
