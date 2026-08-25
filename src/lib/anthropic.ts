import Anthropic from "@anthropic-ai/sdk";

/** 返答の生成に使うモデル。 */
export const CHAT_MODEL = "claude-opus-5";

/**
 * 1回の送信でモデルへ渡す過去の発言数の上限（今回の発言を含む）。
 *
 * 履歴は毎回まるごと送り直すため、上限が無いと長く続いたスレッドほど1往復の入力トークンが
 * 際限なく伸びる。相談の文脈として遡れれば十分な範囲に切る。
 */
export const HISTORY_LIMIT = 30;

/** 返答1回あたりの上限トークン。思考ぶんもここから消費される。 */
export const MAX_OUTPUT_TOKENS = 16000;

/**
 * 音声モードの上限トークン。
 *
 * 読み上げは黙って聞くしかなく、長い返答は飛ばし読みができない。文字のときと同じ上限に
 * しておくと、指示を無視して長く書いた回だけ数分の独白になる。ここで頭を止める。
 */
export const VOICE_MAX_OUTPUT_TOKENS = 1200;

/** 返答をどう受け取るか。体裁の指示と上限トークンがこれで変わる（#27）。 */
export type ReplyStyle = "text" | "voice";

const SECRETARY_INTRO = `あなたは利用者ひとりに付く秘書です。プライベートの相談相手として、日本語で応対します。`;

/** 受け取り方によらない、秘書としての振る舞い。 */
const COMMON_RULES = [
  "結論から書く。前置き・相槌・気遣いの一文で行数を使わない",
  "期日・金額・手続きの名前など、実際に動くために要る具体を落とさない",
  "判断に必要な情報が足りないときは、推測で埋めずに何が要るかを聞く",
  "確かでないことは確かでないと言う。それらしい数字・制度名・期限を作らない",
  "相手は同じ人がずっと続けて相談してきます。毎回名乗り直さない",
];

/** 画面で読む前提の体裁。 */
const TEXT_FORMAT_RULES = [
  "内容が増えるときは見出しと箇条書き、比較は表にする（返答はMarkdownとして整形表示されます）",
];

/**
 * 読み上げる前提の体裁（#27）。
 *
 * 画面で読むのと声で聞くのとでは、伝わる返答の形がまるで違う。見出しや表は読み上げると
 * 意味を成さず、長い返答は聞き終わるまで戻れない。
 *
 * **体裁の指示は足すのではなく差し替える。** 画面向けの「見出しと箇条書き、比較は表に」を
 * 残したまま音声向けの指示を足すと、系統だった矛盾を渡すことになる。
 */
const VOICE_FORMAT_RULES = [
  "3文以内・200文字以内を目安にする。続きがあるときは最後に「詳しく話しますか」と一言だけ添える",
  "この返答は読み上げられます。見出し・箇条書き・表・コードブロック・記号の装飾は使わない",
  "URLや長い英数字の羅列は読み上げない。「画面でお伝えします」と言い、本文の最後にまとめて置く",
  "話し言葉で書く。ただし結論は最初に言う",
];

export function secretarySystemPrompt(style: ReplyStyle): string {
  const rules = [
    ...COMMON_RULES,
    ...(style === "voice" ? VOICE_FORMAT_RULES : TEXT_FORMAT_RULES),
  ];

  return `${SECRETARY_INTRO}\n\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
}

export function maxOutputTokens(style: ReplyStyle): number {
  return style === "voice" ? VOICE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS;
}

let client: Anthropic | undefined;

/**
 * Anthropicクライアントを返す。
 *
 * モジュールの読み込み時ではなく呼び出し時に組み立てる。`ANTHROPIC_API_KEY` はビルド時には
 * 存在せず（CIもGitHub Actions上のビルドも値を持たない）、import時に検証すると
 * `next build` がこのモジュールを辿った時点で落ちるため。
 */
export function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません");
  }

  client ??= new Anthropic();
  return client;
}
