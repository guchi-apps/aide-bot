/**
 * 相談画面の2つのモード。
 *
 * **`write`（書く）が既定**（#279で `voice` から変えた）。日常は文字で読み書きし、声で話したく
 * なったら「書く」画面の下の「話しかける」（音声バー。`@/components/chat/voice-bar`）を押す、
 * という使い方に合わせたもの。`voice`（秘書の立ち絵の全画面）はヘッダーの切り替えから今までどおり
 * 使える——**声そのものをやめたわけではない**（#27の「本来の使い方は音声」は、音声バーが
 * 引き継いでいる）。
 *
 * 選んだモードはCookieに置く。localStorageだと最初の描画がサーバー側で決まらず、
 * 「話す」を選んでいる人にも一瞬だけ文字の画面が出てから切り替わる。
 */

export type TalkMode = "voice" | "write";

export const TALK_MODE_COOKIE = "aide-bot-talk-mode";

/** 1年。相談のたびに選び直させないため、実質「次に変えるまで」の意味で置く。 */
export const TALK_MODE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeTalkMode(value: string | undefined | null): TalkMode {
  return value === "voice" ? "voice" : "write";
}
