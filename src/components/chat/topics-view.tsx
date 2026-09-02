import { topicCategoryShort } from "@/lib/topic-categories";
import type { TopicBoard, TopicRow } from "@/lib/topics";
import { cn } from "@/lib/utils";

import { TopicCategoryPicker } from "./topic-category-picker";

type Props = {
  board: TopicBoard;
  /** 描画の基準になる時刻。「◯時間前」の計算に使う（サーバー側で決めて渡す）。 */
  now: Date;
};

/**
 * 仕入れた話題の一覧（#144）。
 *
 * `/notices` と同じくサーバーコンポーネントのまま置き、種類を選ぶ部品だけをクライアントにする。
 * 並べる順は新しい順。上段に「仕入れる種類」を置くのは、変えた効果がすぐ下の一覧で見えるため。
 */
export function TopicsView({ board, now }: Props) {
  const { categories, lastFetchedAt, topics, bubbleLimit, lifetimeHours } = board;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[0.8125rem] font-bold">仕入れる種類</h2>
            <span className="text-[0.6875rem] text-muted">選んだ種類だけを、アプリを開いたときにウェブで調べます</span>
          </div>
          <TopicCategoryPicker initial={categories} />
        </section>

        <div className="grid grid-cols-3 gap-2.5 md:gap-3">
          <Stat label="溜まっている" value={`${topics.length}`} unit="件" note={`仕入れてから${lifetimeHours}時間で入れ替わる`} highlighted />
          <Stat
            label="最後に仕入れた"
            value={lastFetchedAt ? timeLabel(lastFetchedAt) : "—"}
            note={
              lastFetchedAt
                ? `${elapsedLabel(lastFetchedAt, now)}。次は1時間あけて、画面を開いたとき`
                : categories.length === 0
                  ? "仕入れを止めています"
                  : "「話す」画面を開くと仕入れます"
            }
          />
          <Stat label="吹き出しに出す" value={`${Math.min(bubbleLimit, topics.length)}`} unit="件" note={`新しい順に、輪へ最大${bubbleLimit}枠`} />
        </div>

        {topics.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            {categories.length === 0
              ? "仕入れを止めています。上の種類を1つ以上選ぶと、次に「話す」画面を開いたときに仕入れます。"
              : "まだ話題がありません。「話す」画面を開くと仕入れが始まり、30秒ほどで並びます（画面は読み込み直してください）。"}
          </p>
        ) : (
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[0.8125rem] font-bold">いまの話題（{topics.length}件）</h2>
              <span className="text-[0.6875rem] text-muted">新しい順</span>
            </div>
            <div className="flex flex-col">
              {topics.map((topic) => (
                <TopicArticle key={topic.id} topic={topic} />
              ))}
            </div>
          </section>
        )}

        <p className="text-[0.6875rem] leading-relaxed text-muted">
          <b className="font-medium text-foreground">
            話題はお知らせとは別の場所に溜まり、通知（Push）にはなりません。
          </b>
          吹き出しに出るのは新しい{bubbleLimit}件だけで、{lifetimeHours}時間経つと入れ替わります。相談のときも、直近の話題を秘書が
          材料として持っています（頼まれていないのに持ち出すことはありません）。要点と一言はモデルが
          記事から書いたもので、細部は出典の記事で確かめてください。
        </p>
      </div>
    </div>
  );
}

/** 上段の数え札。`/notices` の `Stat` と同じ形。 */
function Stat({
  label,
  value,
  unit,
  note,
  highlighted = false,
}: {
  label: string;
  value: string;
  unit?: string;
  note: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border border-border bg-surface px-2.5 py-3 md:px-4 md:py-3.5",
        highlighted && "border-accent/45 bg-accent-surface",
      )}
    >
      <div className="text-[0.6875rem] font-bold tracking-[0.1em] text-muted">{label}</div>
      <div className="flex items-baseline gap-1 tabular-nums">
        <b className="text-[1.375rem] font-bold leading-tight tracking-tight md:text-[1.625rem]">{value}</b>
        {unit && <span className="text-[0.8125rem] text-muted">{unit}</span>}
      </div>
      <div className="text-[0.6875rem] leading-relaxed text-muted">{note}</div>
    </div>
  );
}

/**
 * 1件ぶん。見出し（出典へのリンク）・要点・秘書の一言・媒体の4段。
 *
 * 見出しと「開く」を1つのリンクにまとめる（`/notices` の `Title` と同じ理由）。出典は外部の
 * 記事なので常に新しいタブで開く。
 */
function TopicArticle({ topic }: { topic: TopicRow }) {
  const meta = [topic.sourceName, topic.publishedOn].filter((part) => part !== "");

  return (
    <article className="flex flex-col gap-1 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 rounded-full bg-topic-surface px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-topic">
          {topicCategoryShort(topic.category)}
        </span>
        {topic.url ? (
          <a
            href={topic.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${topic.title}の記事を開く`}
            className="inline-flex flex-wrap items-center gap-1.5 no-underline"
          >
            <span className="text-sm font-semibold underline decoration-accent/55 underline-offset-4">{topic.title}</span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-bold text-accent">
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
            </span>
          </a>
        ) : (
          <span className="text-sm font-semibold">{topic.title}</span>
        )}
        {/* PCでは右端へ寄せ、スマホでは折り返して次の行の先頭へ落とす。 */}
        <span className="w-full shrink-0 text-[0.6875rem] tabular-nums text-muted md:ml-auto md:w-auto">
          {timeLabel(topic.fetchedAt)}に仕入れました
        </span>
      </div>
      <p className="m-0 text-[0.8125rem] leading-relaxed">{topic.summary}</p>
      {/* 吹き出しに出る一言。要約と見分けるため、引用の形にする。 */}
      <p className="m-0 border-l-2 border-topic/60 pl-2.5 text-[0.8125rem] leading-relaxed">
        <span className="mr-1.5 text-[0.625rem] tracking-wider text-muted">秘書の一言</span>
        {topic.lead}
      </p>
      {meta.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
          {meta.map((part, index) => (
            <span key={part + index}>
              {index > 0 && <span className="mr-1.5 opacity-50">・</span>}
              {part}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}

/** 日本時間の時刻（`12:40`）。 */
function timeLabel(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** 「3分前」「2時間前」。 */
function elapsedLabel(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "たったいま";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
