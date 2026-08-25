import Anthropic from "@anthropic-ai/sdk";

import type { ReplyStyle } from "@/lib/chat-model";

/**
 * 返答の生成に使うモデルの定義は `@/lib/chat-model` にある（#71）。
 *
 * このモジュールはAnthropic SDKを引き込むため、モデルを選ぶ画面からはimportできない。
 * 単価・選べるモデル・既定値はそちらへ置き、ここには体裁の指示と上限トークンだけを残す。
 */

/**
 * 1回の送信でモデルへ渡す過去の発言数の目安（今回の発言を含む）。
 *
 * 履歴は毎回まるごと送り直すため、上限が無いと長く続いたスレッドほど1往復の入力トークンが
 * 際限なく伸びる。相談の文脈として遡れれば十分な範囲に切る。
 *
 * **ちょうどこの数で切るわけではない**（#56）。窓の先頭は `HISTORY_WINDOW_STEP` の刻みでしか
 * 動かさないため、実際に送るのは `HISTORY_LIMIT` 〜 `HISTORY_LIMIT + HISTORY_WINDOW_STEP - 1`
 * 発言になる。理由は `historyWindowSkip()` を参照。
 */
export const HISTORY_LIMIT = 30;

/**
 * 履歴の窓の先頭を動かす刻み（#56）。
 *
 * プロンプトキャッシュは前方一致で、プレフィックスが1バイトでも変わると以降が全部無効になる。
 * `HISTORY_LIMIT` を超えたスレッドで窓を1発言ずつ滑らせると、**往復のたびに先頭の発言が
 * 変わり、キャッシュが一度も効かない。** 先頭をこの刻みでしか動かさないことで、刻みぶんの
 * あいだは同じプレフィックスを送り続けられる。
 */
export const HISTORY_WINDOW_STEP = 10;

/**
 * 履歴の窓の先頭（古い方から読み飛ばす発言数）を返す（#56）。
 *
 * 窓は `HISTORY_LIMIT` ちょうどではなく `HISTORY_LIMIT + HISTORY_WINDOW_STEP - 1` 発言まで
 * 伸びる。伸びたぶんはキャッシュ読み（通常の入力の約1/10の単価）で乗るので、毎回まるごと
 * 読み直させるより安い。
 */
export function historyWindowSkip(totalMessages: number): number {
  if (totalMessages <= HISTORY_LIMIT) return 0;

  return Math.floor((totalMessages - HISTORY_LIMIT) / HISTORY_WINDOW_STEP) * HISTORY_WINDOW_STEP;
}

/** 返答1回あたりの上限トークン。思考ぶんもここから消費される。 */
export const MAX_OUTPUT_TOKENS = 16000;

/**
 * 音声モードの上限トークン。
 *
 * 読み上げは黙って聞くしかなく、長い返答は飛ばし読みができない。文字のときと同じ上限に
 * しておくと、指示を無視して長く書いた回だけ数分の独白になる。ここで頭を止める。
 */
export const VOICE_MAX_OUTPUT_TOKENS = 1200;

/**
 * リモートMCPサーバーへ繋ぐためのベータ指定（#46）。
 *
 * この機能はまだベータで、指定しないと `mcp_servers` ごと弾かれる。
 * 前の版（`mcp-client-2025-04-04`）は非推奨で、ツールの絞り込みの書き方が違う。
 */
export const MCP_BETA = "mcp-client-2025-11-20";

/**
 * 外部サービスへ繋いでいるときに、上限トークンへ上乗せするぶん（#46）。
 *
 * `max_tokens` は本文だけでなくツール呼び出しのぶんも含む。特に音声モードの1200は
 * 「聞くだけの返答を短く保つ」ための値で、ツールを2回呼んだだけで本文へ回るぶんが
 * 尽きる。体裁の指示は据え置いたまま、呼び出しに使う余地だけをここで足す。
 */
export const MCP_TOKEN_ALLOWANCE = 4000;

/**
 * 返答をどう受け取るか（#27）。定義は `@/lib/chat-model` にあり、ここでは読み直すだけ。
 *
 * モデルを選ぶ画面（クライアント）と、返答を作る側（サーバー）の両方が同じ型を使うため、
 * Anthropic SDKを引き込まない側に本体を置いてある。
 */
export type { ReplyStyle };

const SECRETARY_INTRO = `あなたは利用者ひとりに付く秘書です。プライベートの相談相手として、日本語で応対します。`;

/**
 * 割り込まれた返答の末尾へ足す注記（#48）。
 *
 * 利用者は返答の途中でも次の発言を送れる。途中で切れた返答をそのまま履歴へ入れると、
 * モデルからは「短く言い切った返答」と見分けが付かず、続きを最初から言い直したり、
 * 遮って言われたことを無視したりする。履歴を組み立てるときにだけ足し、DBには入れない。
 */
export const INTERRUPTED_NOTE = "（この返答は利用者に遮られ、ここで途切れています）";

/** 受け取り方によらない、秘書としての振る舞い。 */
const COMMON_RULES = [
  "結論から書く。前置き・相槌・気遣いの一文で行数を使わない",
  "期日・金額・手続きの名前など、実際に動くために要る具体を落とさない",
  "判断に必要な情報が足りないときは、推測で埋めずに何が要るかを聞く",
  "確かでないことは確かでないと言う。それらしい数字・制度名・期限を作らない",
  "相手は同じ人がずっと続けて相談してきます。毎回名乗り直さない",
  `過去のあなたの返答が「${INTERRUPTED_NOTE}」で終わっている場合、利用者はそこで話を遮っています。途切れた続きを言い直さず、遮って言われたことにそのまま答える。遮られたこと自体を詫びない`,
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

/**
 * 繋いでいる外部サービスについての指示（#46）。
 *
 * ツールの説明文だけでも呼び分けはできるが、**音声モードでは「短く答える」指示と
 * ぶつかって呼ばずに済ませてしまう**。手元に無い事実は調べてから答える、と明示する。
 */
function connectedServiceRules(labels: string[]): string[] {
  if (labels.length === 0) return [];

  return [
    `${labels.join("・")}に繋がっていて、その中のデータを取ってくる道具が使えます`,
    "残高・予定・部屋の状態・記録の中身など、手元に無い事実を尋ねられたら、推測せず道具で調べてから答える",
    "道具で取れなかったときは、取れなかったことをそのまま言う。それらしい数字で埋めない",
  ];
}

export function secretarySystemPrompt(style: ReplyStyle, connectedLabels: string[] = []): string {
  const rules = [
    ...COMMON_RULES,
    ...connectedServiceRules(connectedLabels),
    ...(style === "voice" ? VOICE_FORMAT_RULES : TEXT_FORMAT_RULES),
  ];

  return `${SECRETARY_INTRO}\n\n${rules.map((rule) => `- ${rule}`).join("\n")}`;
}

export function maxOutputTokens(style: ReplyStyle, hasTools = false): number {
  const base = style === "voice" ? VOICE_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS;
  return hasTools ? base + MCP_TOKEN_ALLOWANCE : base;
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
