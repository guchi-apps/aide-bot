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
 * 朝の見通し（#79）を書くモデル。**#183でCodexへ移した最後の1本。**
 *
 * #128（チャット）・#132（お知らせ選定）・#167（自宅の前提）に続く移行で、これで
 * アプリからAnthropic（従量課金）を呼ぶ経路は無くなった。
 *
 * **ここだけ旗艦のSolにしてある。** 6本の道具から集めた材料を、条件（`BRIEFING_MATERIAL_RULES`）
 * で取捨選択したうえで200文字に収める、という判断の要る仕事で、**1日1本しか走らない**ので
 * サブスクの利用枠への影響も小さい。しかも書き損じても直す機会が無い（届いたら終わり）。
 *
 * 設定の画面からは選べない——選ぶ主体が居ない場面（cronから叩かれる）で使うため、
 * Cookieを読めない。
 */
export const BRIEFING_MODEL = "gpt-5.6-sol";

/**
 * 吹き出しに出すお知らせを1件選ぶモデル（#93）。**#132でCodexへ移した。**
 *
 * `ChatModelId` と同じCodexのモデル名だが、型は分けてある——こちらは設定の画面から選べず、
 * 選ぶ主体が居ない場面（10分ごとの問い合わせ）で使うため。**いちばん速く安いLunaにしてある。**
 * やらせているのは「12件の候補から1件選んで40字前後に言い直す」だけで、賢さより往復の速さが効く
 * （`/api/notices/current` の応答がそのぶん待たされる）。
 */
export const NOTICE_MODEL = "gpt-5.6-luna";

/**
 * 話題（#144）を仕入れるモデル。`codex --search exec` でウェブ検索させる。
 *
 * `NOTICE_MODEL` と同じく設定の画面からは選べない（仕入れは応答後のバックグラウンドで走り、
 * 選ぶ主体が居ない）。Lunaにしてあるのは、やらせているのが「検索結果から数件を選んで
 * 短く要約する」だけで、1回あたり27秒前後・入力6万トークン超（実測）と重い経路のため、
 * これより重いモデルにするとサブスクの利用枠の減りが早くなる。
 */
export const TOPIC_MODEL = "gpt-5.6-luna";

/**
 * 連続セッションの古い発言を要約へ畳むモデル（#157のcompact）。
 *
 * `NOTICE_MODEL`・`TOPIC_MODEL` と同じく設定の画面からは選べない（返答を返した後の
 * 後始末で走り、選ぶ主体が居ない）。**ここだけ中位のTerraにしてある。** 落とすものを
 * 選び損ねると、その要約が以後ずっと文脈として使われ、あとから直す機会が無い——
 * 40発言ごとに1回しか走らないので、利用枠への影響も小さい。
 */
export const COMPACT_MODEL = "gpt-5.6-terra";

/**
 * Notionから「自宅・暮らしの前提」を取り込むモデル（#167）。
 *
 * `COMPACT_MODEL` と同じ理由で中位のTerraにしてある。**取り込んだ覚え書きは相談の
 * プロンプトへ毎回載り、次に取り込み直すまで（最短でも1日）使われ続ける**ので、
 * 探し損ね・読み違いが1日ぶんそのまま効く。走るのは1日1回＋設定の画面のボタンだけで、
 * 利用枠への影響も小さい。設定の画面からは選べない（選ぶ主体が居ない場面で走る）。
 */
export const HOME_PROFILE_MODEL = "gpt-5.6-terra";

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
