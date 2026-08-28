"use client";

import { cn } from "@/lib/utils";

import type { RobotState } from "./robot";
import type { NoticeBubble } from "./use-notice";

/**
 * 秘書の頭上に出る吹き出し（#93）。
 *
 * 2つの役目を1つの吹き出しで担う。
 *
 * - **待っている間**は、各アプリが積んだお知らせから秘書が選んだ一言（`notice`）
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
  /** 待機中に出すお知らせ。無ければ既定の呼びかけを出す。 */
  notice: NoticeBubble | null;
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

export function SpeechBubble({ state, notice, activity }: Props) {
  // 待っている間だけお知らせを出す。往復中は状態に譲る。
  const showing = state === "idle" ? notice : null;

  const text = showing
    ? showing.text
    : state === "thinking" && activity
      ? // 外部サービスを見に行っている間は、待たせている理由を出す（#46）。
        `${activity.server}を調べています`
      : STATUS_LABEL[state];

  const urgent = showing?.urgent ?? false;
  const stamp = showing ? stampOf(showing.shownAt) : "";

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
    <div className="flex min-h-[74px] w-full items-end justify-center" aria-live="polite">
      <span
        key={text}
        className={cn(
          "relative inline-flex max-w-[min(23rem,100%)] items-center gap-[9px] rounded-[20px] border px-[17px] py-2.5 text-left text-[0.90625rem] leading-relaxed shadow-[0_12px_26px_-16px_rgba(15,23,42,0.35)]",
          motion,
          urgent
            ? "border-accent/40 bg-accent-surface font-bold text-accent"
            : showing
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
