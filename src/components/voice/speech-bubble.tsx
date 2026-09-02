"use client";

import Link from "next/link";

import { isExternalNoticeUrl } from "@/lib/notice-url";
import { cn } from "@/lib/utils";

import type { RobotState } from "./robot";
import type { BubbleLine } from "./use-notice";

/**
 * 秘書の頭上に出る吹き出し（#93）。
 *
 * 2つの役目を1つの吹き出しで担う。
 *
 * - **待っている間**は、`line`——お知らせ（#93）・ひとりごと（#101）・呼びかけを順に回したもの
 * - **往復の最中**は、いまの状態（聞いています・考えています…）
 *
 * 分けずに1つにしてあるのは、置ける場所が絵の真上の1か所しかないため。2つ並べると
 * スマホ（393×852）で絵か字幕のどちらかが押し出される。往復に入れば状況の報せは
 * 待てるので、そのあいだは状態に譲る。
 *
 * 動きは `globals.css` の `.bubble-*` / `.ind-*` に置く——状態ごとのキーフレームを
 * Tailwindのユーティリティでは書けないため（`.bot` と同じ理由）。
 *
 * `key` に出す文字列そのものを渡しているので、**中身が変わるたびReactが作り直し、
 * 出てくる動きがもう一度再生される。**
 */

type Props = {
  state: RobotState;
  /** 待機中に出す1枠（`use-notice.ts` が一定の間隔で送ってくる）。無ければ既定の呼びかけ。 */
  line: BubbleLine | null;
  /** 外部サービスを見に行っている間の表示（#46）。 */
  activity: { server: string; tool: string } | null;
};

/**
 * 状態の文言。**吹き出しは秘書が喋っている形なので、状態の説明ではなく話し言葉にする。**
 * 読み上げソフトはこの文字列をそのまま読む（`aria-live="polite"`）。
 */
const STATUS_LABEL: Record<RobotState, string> = {
  idle: "どうぞ、話しかけてください",
  listening: "聞いています",
  thinking: "考えています",
  preparing: "声を用意しています",
  speaking: "お話ししています",
};

/** 選ばれた時刻。「いつ時点の話か」が分かると、古い報せを新しい話と読まずに済む。 */
function stampOf(iso: string): string {
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
function OpenLink({ url }: { url: string }) {
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

/** 文字を読まなくても状態が分かる小さなしるし。状態ごとに動きを変える。 */
function Indicator({ state }: { state: RobotState }) {
  if (state === "thinking") {
    return (
      <span className="ind-dots flex shrink-0 items-center gap-[3px]" aria-hidden="true">
        <span className="size-[5px] rounded-full bg-current" />
        <span className="size-[5px] rounded-full bg-current" />
        <span className="size-[5px] rounded-full bg-current" />
      </span>
    );
  }

  if (state === "preparing") {
    return (
      <span
        className="ind-spin size-[13px] shrink-0 rounded-full border-[2.5px] border-current border-r-transparent"
        aria-hidden="true"
      />
    );
  }

  if (state === "listening" || state === "speaking") {
    return (
      <span
        className={cn(
          "ind-bars flex h-3.5 shrink-0 items-center gap-[3px]",
          // 話しているときは速く振る。聞いているときとの区別を動きだけで付ける。
          state === "speaking" && "ind-bars-fast",
        )}
        aria-hidden="true"
      >
        <span className="h-3.5 w-[3px] rounded-sm bg-current" />
        <span className="h-3.5 w-[3px] rounded-sm bg-current" />
        <span className="h-3.5 w-[3px] rounded-sm bg-current" />
      </span>
    );
  }

  return <span className="ind-pulse size-[7px] shrink-0 rounded-full bg-current" aria-hidden="true" />;
}

export function SpeechBubble({ state, line, activity }: Props) {
  // 待っている間だけ輪の中身を出す。往復中は状態に譲る。
  const showing = state === "idle" ? line : null;
  const notice = showing?.kind === "notice" ? showing.notice : null;

  const text =
    showing?.kind === "notice"
      ? showing.notice.text
      : showing?.kind === "chatter"
        ? showing.text
        : state === "thinking" && activity
          ? // 外部サービスを見に行っている間は、待たせている理由を出す（#46）。
            `${activity.server}を調べています`
          : STATUS_LABEL[state];

  const urgent = notice?.urgent ?? false;
  const stamp = notice ? stampOf(notice.shownAt) : "";

  /**
   * 読み上げソフトへ知らせるかどうか（#101）。
   *
   * **ひとりごとが替わっただけの回は知らせない。** 25秒ごとに読み上げが割り込むと、
   * 画面のほかの操作が追えなくなる。お知らせと状態の変化は今までどおり知らせる。
   */
  const announce = showing?.kind !== "chatter";

  const motion = urgent
    ? "bubble-alert"
    : state === "idle"
      ? "bubble-float"
      : state === "speaking"
        ? "bubble-beat"
        : "bubble-pop";

  return (
    // 高さを先に取っておく。文言の長さで背が変わっても、下の絵と字幕が上下しない。
    //
    // **`aria-live` は外側の、作り直されない要素に置く。** 中の吹き出しは `key` を変えて
    // わざと作り直しているが、読み上げ領域そのものを作り直すと、支援技術からは「中身が
    // 変わった」ではなく「新しい領域が現れた」に見え、読み上げられないことがある。
    <div
      className="flex min-h-[74px] w-full items-end justify-center"
      aria-live={announce ? "polite" : "off"}
    >
      <span
        key={text}
        className={cn(
          "relative inline-flex max-w-[min(23rem,100%)] items-center gap-[9px] rounded-[20px] border px-[17px] py-2.5 text-left text-[0.90625rem] leading-relaxed shadow-[0_12px_26px_-16px_rgba(15,23,42,0.35)]",
          motion,
          urgent
            ? "border-accent/40 bg-accent-surface font-bold text-accent"
            : // 呼びかけと状態の文言だけ太字にする。ひとりごととお知らせは地の文として置く。
              showing?.kind === "notice" || showing?.kind === "chatter"
              ? "border-border bg-surface font-medium text-foreground"
              : "border-border bg-surface font-bold text-foreground",
        )}
      >
        <span className={cn("flex shrink-0 items-center", urgent ? "text-current" : "text-accent")}>
          <Indicator state={state} />
        </span>

        {urgent && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-accent-foreground">
            急ぎ
          </span>
        )}

        <span className="text-pretty">{text}</span>

        {notice?.url && <OpenLink url={notice.url} />}

        {stamp !== "" && (
          <span
            className={cn(
              "shrink-0 text-[0.6875rem] font-medium tabular-nums",
              urgent ? "text-current opacity-70" : "text-muted",
            )}
          >
            {stamp}
          </span>
        )}

        {/* しっぽ。真下の絵を指す。枠線が続いて見えるよう、正方形を45度回して2辺だけ描く。 */}
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-[7px] left-1/2 -ml-[6.5px] size-[13px] rotate-45 rounded-br-[3px] border-b border-r",
            urgent ? "border-accent/40 bg-accent-surface" : "border-border bg-surface",
          )}
        />
      </span>
    </div>
  );
}
