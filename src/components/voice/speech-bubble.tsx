"use client";

import Link from "next/link";

import { isExternalNoticeUrl } from "@/lib/notice-url";

/**
 * 声の往復の状態。聞き取り・考え中・声の用意（VOICEVOXの合成待ち）・読み上げのあいだを動く。
 *
 * **`preparing` は「考えています」とは別に持つ。** VOICEVOX（キー無し）は依頼から最初の音まで
 * 6〜8秒かかり、その間も「考えています」のままだと、7秒前後の無音が「返事が来ないだけ」に見えて、
 * 利用者はマイクを押して割り込む。
 */
export type SecretaryState = "idle" | "listening" | "thinking" | "preparing" | "speaking";

/**
 * 状態の文言。**吹き出しは秘書が喋っている形なので、状態の説明ではなく話し言葉にする。**
 * 読み上げソフトはこの文字列をそのまま読む（`aria-live="polite"`）。
 *
 * 口調は秘書の人格（`@/lib/persona`。#226）に手で揃える。**変えたらCLAUDE.mdの「聞き取りを
 * マイク無しで確かめる」も直す**——検証手順がこの文字列で状態を読んでいる。
 *
 * **「書く」画面の音声バー（`@/components/chat/voice-bar`。#279）も同じ表を読む。** 同じ
 * 往復の同じ状態なので、画面ごとに言い方が変わらないようにする。
 */
export const STATUS_LABEL: Record<SecretaryState, string> = {
  idle: "どうぞ、話しかけてください",
  listening: "はい、聞いていますよ",
  thinking: "少し考えますね",
  preparing: "声を用意しています",
  speaking: "お話ししています",
};

/**
 * 選ばれた時刻。「いつ時点の話か」が分かると、古い報せを新しい話と読まずに済む。
 *
 * 「書く」画面の秘書の一言（`@/components/chat/secretary-line`。#279）も同じものを出す。
 */
export function noticeStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 押したときに開く先（#137）。**お知らせがリンクを持っている回だけ出す。**
 *
 * - **吹き出しそのものはリンクにしない。** 待機中の吹き出しは25秒ごとに入れ替わる（#101）ので、
 *   面全体が押せると読んでいる途中の誤タップになる。押せるのはこの1つだけにする
 * - **別のアプリのページは新しいタブで開く**（`target="_blank"`）。秘書の画面を閉じずに済み、
 *   見終えたらそのまま話しかけられる。アプリの中のパス（朝の見通しの相談など）は
 *   `next/link` で同じタブのまま移る
 * - `stopPropagation` は要らない。親に押したときの処理を持たせていないため
 */
export function OpenLink({ url }: { url: string }) {
  const label = "元のページを開く";
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/45 bg-surface px-2.5 py-0.5 text-[0.6875rem] font-bold text-accent no-underline";

  const inner = (
    <>
      開く
      <svg
        viewBox="0 0 24 24"
        className="size-2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M7 17 17 7" />
        <path d="M9 7h8v8" />
      </svg>
    </>
  );

  if (isExternalNoticeUrl(url)) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={label} className={className}>
        {inner}
      </a>
    );
  }

  return (
    <Link href={url} aria-label={label} className={className}>
      {inner}
    </Link>
  );
}

