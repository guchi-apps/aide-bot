/**
 * 返答の生成に使うモデルと、その単価（#71・#51）。
 *
 * **このモジュールはクライアントコンポーネントからもimportする。** 設定の画面がモデルを
 * 選ぶため、PrismaやAnthropic SDKに触れるものをここへ持ち込まないこと（`src/lib/usage.ts`
 * や `src/lib/app-version.ts` をサーバー専用に保っているのと同じ理由で、引き込んだものが
 * そのままクライアントバンドルへ入る）。
 *
 * Cookieの読み書きもここには置かない。`next/headers` はサーバー専用で、import した時点で
 * クライアント側のビルドが落ちる（読み出しは `src/lib/chat-model-server.ts`）。
 */

/** 返答をどう受け取るか。体裁の指示と上限トークンがこれで変わる（#27）。 */
export type ReplyStyle = "text" | "voice";

/** 100万トークンあたりの単価（USD）。 */
export type ModelPricing = {
  input: number;
  output: number;
  /** プロンプトキャッシュへの書き込み（TTL 5分）。 */
  cacheWrite: number;
  /** プロンプトキャッシュからの読み出し。 */
  cacheRead: number;
};

/**
 * モデルごとの単価。
 *
 * **Anthropicが単価を変えたらここを直す。** 画面に出るのはこの表からの概算で、
 * 実際の請求額ではない。過去のぶんも呼び出した時点のモデル名で引き直すため、
 * 使うのをやめたモデルの行も消さずに残す。
 *
 * 出典: https://claude.com/pricing#api（2026-08-25 時点）
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

export type ChatModelId = "claude-opus-5" | "claude-sonnet-5" | "claude-haiku-4-5";

export type ChatModelOption = {
  id: ChatModelId;
  /** 画面に出す名前。 */
  label: string;
  /**
   * プロンプトキャッシュが効き始める最小のトークン数（#56・#71）。
   *
   * これを下回るリクエストでは、ブレークポイントを置いても黙って無視される。
   * **世代順に単調ではない**ので、モデルを増やすときは推測せず単価と一緒に調べ直す。
   */
  cacheMinimumTokens: number;
};

/**
 * 選べるモデル。安い順ではなく賢い順に並べる（画面の並びもこの順）。
 *
 * 増やすときは `MODEL_PRICING` にも同じidの行を足すこと。単価が無いモデルは、
 * 使用量の画面で既定のモデルの単価で概算されてしまう。
 */
export const CHAT_MODELS: ChatModelOption[] = [
  { id: "claude-opus-5", label: "Claude Opus 5", cacheMinimumTokens: 512 },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", cacheMinimumTokens: 1024 },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", cacheMinimumTokens: 4096 },
];

/**
 * 何も選んでいないときのモデル。
 *
 * #71より前はこれのハードコードしか無かった。既定を変えると、設定を触っていない端末の
 * 返答が黙って変わるので、変えるときは画面の案内も一緒に見直す。
 */
export const DEFAULT_CHAT_MODEL: ChatModelId = "claude-opus-5";

/**
 * 選んだモデルを置くCookie（`aide-bot-talk-mode` と同じ考え方）。
 *
 * localStorageではなくCookieなのは、**サーバー側でも同じ値を読む必要がある**ため。
 * 返答を生成するのは `/api/chat`（Route Handler）で、使用量の画面もサーバー側で
 * 単価の注記を組み立てている。
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
 * 知らない値は既定へ落とす。利用者が書き換えられる値なので、そのままAPIへ渡すと
 * 存在しないモデル名で400になり、相談そのものが通らなくなる。
 */
export function normalizeChatModel(value: string | undefined | null): ChatModelId {
  const known = CHAT_MODELS.find((model) => model.id === value);
  return known ? known.id : DEFAULT_CHAT_MODEL;
}

/**
 * 既定のモデルと比べた費用の目安。画面のバッジに出す（#71）。
 *
 * 単価表から作るので、`MODEL_PRICING` を直せばバッジも一緒に付いてくる。入力と出力の
 * 比はいまのところ揃っているため、代表として出力ぶんで見る。
 */
export function chatModelCostTag(id: ChatModelId): { text: string; cheaper: boolean } {
  const base = MODEL_PRICING[DEFAULT_CHAT_MODEL];
  const pricing = MODEL_PRICING[id];
  if (!base || !pricing || pricing.output >= base.output) {
    return { text: "いちばん賢い", cheaper: false };
  }

  const ratio = Math.round((base.output / pricing.output) * 10) / 10;
  return { text: `費用 約1/${Number.isInteger(ratio) ? ratio : ratio.toFixed(1)}`, cheaper: true };
}
