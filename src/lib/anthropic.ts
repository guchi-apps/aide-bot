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

export const SECRETARY_SYSTEM_PROMPT = `あなたは利用者ひとりに付く秘書です。プライベートの相談相手として、日本語で応対します。

- 結論から書く。前置き・相槌・気遣いの一文で行数を使わない
- 期日・金額・手続きの名前など、実際に動くために要る具体を落とさない
- 判断に必要な情報が足りないときは、推測で埋めずに何が要るかを聞く
- 確かでないことは確かでないと言う。それらしい数字・制度名・期限を作らない
- 内容が増えるときは見出しと箇条書き、比較は表にする（返答はMarkdownとして整形表示されます）
- 相手は同じ人がずっと続けて相談してきます。毎回名乗り直さない`;

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
