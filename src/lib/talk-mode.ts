/**
 * 相談画面の2つのモード。
 *
 * `voice`（話す）が既定。このアプリは音声で秘書と対話するのが本来の使い方で、文字入力は
 * 声を出せない場面と、聞き取れなかったときの言い直しのために残している（#27）。
 *
 * 選んだモードはCookieに置く。localStorageだと最初の描画がサーバー側で決まらず、
 * 「書く」を選んでいる人にも一瞬だけ音声画面が出てから切り替わる。
 */

export type TalkMode = "voice" | "write";

export const TALK_MODE_COOKIE = "aide-bot-talk-mode";

/** 1年。相談のたびに選び直させないため、実質「次に変えるまで」の意味で置く。 */
export const TALK_MODE_MAX_AGE = 60 * 60 * 24 * 365;

export function normalizeTalkMode(value: string | undefined | null): TalkMode {
  return value === "write" ? "write" : "voice";
}
