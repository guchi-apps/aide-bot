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
 * `/usage` 画面の単価表。**Anthropic（Claude）の単価だけを載せる。**
 *
 * **#183で、いま新しく積まれる記録はすべてCodex（サブスク定額）になった。** この表が効くのは
 * **移行前に残った記録**（朝の見通しがClaudeで動いていた日ぶん）を引き直すときだけなので、
 * 使わなくなった行も消さない——呼び出した時点のモデル名で引くため、消すとその日の費用が
 * 概算に化ける。
 *
 * **この表へCodexの行を足してはいけない**——足すと定額のはずの経路に費用が付く。課金の形の
 * 判定は `billingKind()` が持つ。
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

/**
 * 課金の形（#133）。`/usage` はこれで節を割る。
 *
 * - `subscription`：Codex（ChatGPTのサブスク枠）。**トークン単価が存在しない。**
 *   使った量は分かるが費用は0円で、代わりに利用枠（5時間ローリング＋週次）を消費する
 * - `metered`：Anthropic（Claude）。トークン数×単価で概算費用を出す。**#183で新しく積まれる
 *   ことは無くなった**（移行前に残った記録だけがここに入る）
 */
export type BillingKind = "subscription" | "metered";

/**
 * モデル名から課金の形を決める。
 *
 * **単価表に載っているかどうかでは判定しない。** 表に無いClaudeのモデル（新しい版・
 * 使うのをやめた版）まで「定額」に倒れてしまい、費用が黙って0円になる。Codexが提供するのは
 * GPT系だけなので、そちらを名指しする向きにしてある——知らない名前は従量課金として扱い、
 * 単価が引けなければ既定の単価で概算する（`estimateCostUsd()`。0円にして「使っていない」と
 * 読ませない方針は#51から変えていない）。
 */
export function billingKind(model: string | null | undefined): BillingKind {
  return (model ?? "").startsWith("gpt-") ? "subscription" : "metered";
}

/**
 * 選べるモデル（Codex CLIが提供するGPT-6系。#349）。賢い順に並べる（画面の並びもこの順）。
 *
 * Astra＝最高性能、Sol＝バランス、Luna＝いちばん速く安い（`~/.codex/models_cache.json` の
 * `slug` から拾った。利用可能な名前を確かめるCLIコマンドは無い）。サブスクの利用枠
 * （5時間ローリング＋週次）はモデルが重いほど早く減る。
 * GPT-5.6系は、GPT-6系に対応していないアカウント向けの選択肢として末尾に並べる（#358）。
 */
export type ChatModelId =
  | "gpt-6-astra"
  | "gpt-6-sol"
  | "gpt-6-luna"
  | "gpt-5.6-sol"
  | "gpt-5.6-terra"
  | "gpt-5.6-luna";

export type ChatModelOption = {
  id: ChatModelId;
  /** 画面に出す名前。 */
  label: string;
  /** 画面に出す一言。 */
  hint: string;
};

export const CHAT_MODELS: ChatModelOption[] = [
  { id: "gpt-6-astra", label: "Astra", hint: "最高性能" },
  { id: "gpt-6-sol", label: "Sol", hint: "バランス" },
  { id: "gpt-6-luna", label: "Luna", hint: "高速" },
  // GPT-6系にアカウントが対応していない環境向け（#358）。既定にはしない。
  { id: "gpt-5.6-sol", label: "5.6 Sol", hint: "旧・高性能" },
  { id: "gpt-5.6-terra", label: "5.6 Terra", hint: "旧・バランス" },
  { id: "gpt-5.6-luna", label: "5.6 Luna", hint: "旧・高速" },
];

/**
 * モデルを選べる用途（#349）。**正はここ**——画面・保存・各呼び出しが同じ表を引く。
 *
 * 以前は相談だけがCookieで選べ、残りは定数で固定だった。設定の値を読むのが
 * cronや返答後の後始末（Cookieの届かない経路）でもあるので、保存は利用者ごとのDB
 * （`User.modelSettings`）へ持つ。用途を足したら `MODEL_USES`・`MODEL_USE_META`・`DEFAULT_MODELS`
 * の3つを揃える（型で漏れは落ちる）。
 */
export type ModelUse =
  | "chat_voice"
  | "chat_text"
  | "briefing"
  | "proactive"
  | "notice"
  | "topic"
  | "compact"
  | "home_profile"
  | "memory";

export const MODEL_USES: readonly ModelUse[] = [
  "chat_voice",
  "chat_text",
  "briefing",
  "proactive",
  "notice",
  "topic",
  "compact",
  "home_profile",
  "memory",
];

export type ModelUseGroup = "chat" | "scheduled" | "background";

export const MODEL_USE_GROUP_LABELS: Record<ModelUseGroup, string> = {
  chat: "相談",
  scheduled: "定時・通知",
  background: "バックグラウンド",
};

export const MODEL_USE_META: Record<ModelUse, { group: ModelUseGroup; label: string; hint: string }> = {
  chat_voice: { group: "chat", label: "話す", hint: "音声の短い返事" },
  chat_text: { group: "chat", label: "書く", hint: "見出しや表を使う長い返事" },
  briefing: { group: "scheduled", label: "朝の見通し", hint: "毎朝1回・10本の道具を集約" },
  proactive: { group: "scheduled", label: "先回りの提案", hint: "空き時間と希望から判断" },
  notice: { group: "scheduled", label: "お知らせの選定", hint: "吹き出しに出す1件を選ぶ" },
  topic: { group: "background", label: "話題の仕入れ", hint: "ウェブ検索でニュース収集（重い）" },
  compact: { group: "background", label: "会話の要約", hint: "古い発言を畳む" },
  home_profile: { group: "background", label: "自宅の前提", hint: "Notionから取り込み" },
  memory: { group: "background", label: "継続記憶", hint: "候補の抽出と照合" },
};

/**
 * 何も選んでいない用途のモデル。従来の役割に合わせてある（5.6のSol→Astra、Terra→Sol、Luna→Luna）。
 *
 * 変えると、設定を触っていない利用者の返答が黙って変わる。
 */
export const DEFAULT_MODELS: Record<ModelUse, ChatModelId> = {
  chat_voice: "gpt-6-astra",
  chat_text: "gpt-6-astra",
  briefing: "gpt-6-astra",
  proactive: "gpt-6-astra",
  notice: "gpt-6-luna",
  topic: "gpt-6-luna",
  compact: "gpt-6-sol",
  home_profile: "gpt-6-sol",
  memory: "gpt-6-sol",
};

export function isChatModelId(value: unknown): value is ChatModelId {
  return CHAT_MODELS.some((model) => model.id === value);
}

/**
 * 保存してある値（`User.modelSettings`）を、全用途ぶんのモデルへ均す。
 *
 * 知らない用途・知らないモデル名（GPT-5.6系や書き換えられた値）は既定へ落とす。存在しない名前を
 * `codex exec -m` へ渡すと、相談を含むすべての生成が失敗するため。
 */
export function resolveModelSettings(stored: unknown): Record<ModelUse, ChatModelId> {
  const record =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  const resolved = { ...DEFAULT_MODELS };
  for (const use of MODEL_USES) {
    const value = record[use];
    if (isChatModelId(value)) resolved[use] = value;
  }

  return resolved;
}

/** 変更を保存済みの値へ重ねる。既定と同じ値は持たず、既定を後から変えても追従できるようにする。 */
export function mergeModelSettings(stored: unknown, changes: Partial<Record<ModelUse, ChatModelId>>) {
  const current =
    typeof stored === "object" && stored !== null && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};

  const next: Record<string, ChatModelId> = {};
  for (const use of MODEL_USES) {
    const value = use in changes ? changes[use] : current[use];
    if (isChatModelId(value) && value !== DEFAULT_MODELS[use]) next[use] = value;
  }

  return next;
}
