"use client";

import { useMemo, useRef, useState } from "react";

import { jstDayKey, jstTimeLabel } from "@/lib/day-key";
import { buildTimeline, unreadCount } from "@/lib/topic-timeline";
import { OTHER_CATEGORY_ID, topicCategoryShort, type TopicCategory } from "@/lib/topic-categories";
import { cn } from "@/lib/utils";

// `topics.ts` はサーバー専用（Prisma・Codexの起動に触れる）なので、型だけをこの1本の
// `import type` で読む。値の import と同じ文にまとめない——1つでも値を読むと、バンドラーは
// モジュール全体（`node:child_process` に触れる依存を含む）をクライアントの束へ引き込む。
import type { TopicRow } from "@/lib/topics";

const ALL_TAB_ID = "all";
/** これより短い横移動はページの縦スクロールとして扱い、タブは切り替えない。 */
const SWIPE_THRESHOLD_PX = 48;

type Tab = { id: string; label: string; rows: TopicRow[] };

type Props = {
  /** 利用者が持っている種類（無効のものも含む。並び順どおり）。チップの表示名の解決にも使う。 */
  categories: TopicCategory[];
  /** 「すべて」タブの中身（全体で1回だけ重複統合したもの）。 */
  allTopics: TopicRow[];
  /** テーマ別タブの中身。`src/lib/topics.ts` の `TopicBoard.byCategory` を参照。 */
  byCategory: Record<string, TopicRow[]>;
  /** 「すべて」タブの見出しに出す、重複としてまとめた記事の数。 */
  mergedCount: number;
  /**
   * 前回この画面を開いた時刻（#418）。**初回のpropsを `useState` に固定して使う**——`router.refresh()` で
   * 描き直されて新しい値が届いても、開いたばかりの「NEW」と境目の線をその場で消さないため。
   */
  seenAt: Date | null;
  /** 取り込み回の見出しに日付を添えるか（今日以外）の判定に使う。 */
  now: Date;
};

/**
 * 話題のテーマ別タブ（#404）。先頭「すべて」＋種類ごとに話題を絞り込んで表示する。
 *
 * タップに加え、一覧の上で左右にスワイプしても隣のタブへ切り替えられる。判定は`touchend`まで
 * 待って合計の移動距離だけを見る——`touchmove`で`preventDefault()`しないので、ページの縦
 * スクロールを妨げない。タブバー自体の横スクロール（タブ数が多いとき）は、そのすぐ下の
 * カードにだけスワイプ判定を置くことで両立させている。
 */
export function TopicTabs({ categories, allTopics, byCategory, mergedCount, seenAt: initialSeenAt, now }: Props) {
  const [seenAt] = useState(initialSeenAt);
  const [todayKey] = useState(() => jstDayKey(now));
  const tabs = useMemo<Tab[]>(() => {
    const list: Tab[] = [{ id: ALL_TAB_ID, label: "すべて", rows: allTopics }];
    for (const category of categories) {
      const rows = byCategory[category.id];
      if (rows) list.push({ id: category.id, label: category.short, rows });
    }
    const other = byCategory[OTHER_CATEGORY_ID];
    if (other) list.push({ id: OTHER_CATEGORY_ID, label: "その他", rows: other });
    return list;
  }, [categories, allTopics, byCategory]);

  const [activeId, setActiveId] = useState<string>(ALL_TAB_ID);
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === activeId),
  );
  const active = tabs[activeIndex] ?? tabs[0];

  const touch = useRef<{ x: number; y: number; deciding: boolean; horizontal: boolean } | null>(null);

  const onTouchStart = (event: React.TouchEvent) => {
    const point = event.touches[0];
    touch.current = { x: point.clientX, y: point.clientY, deciding: true, horizontal: false };
  };

  const onTouchMove = (event: React.TouchEvent) => {
    const state = touch.current;
    if (!state || !state.deciding) return;
    const point = event.touches[0];
    const dx = point.clientX - state.x;
    const dy = point.clientY - state.y;
    // 最初にある程度動いた時点で、縦スクロールなのか横スワイプなのかを決める。
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
      state.deciding = false;
      state.horizontal = Math.abs(dx) > Math.abs(dy);
    }
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const state = touch.current;
    touch.current = null;
    if (!state || !state.horizontal) return;
    const point = event.changedTouches[0];
    const dx = point.clientX - state.x;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    // 右から左（dx<0）は次のタブ、左から右は前のタブ。端では何もしない（折り返さない）。
    const next = tabs[activeIndex + (dx < 0 ? 1 : -1)];
    if (next) setActiveId(next.id);
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="tablist"
        aria-label="話題のテーマ"
        className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[0.78rem] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              tab.id === active.id
                ? "border-topic bg-topic text-white"
                : "border-border bg-surface text-muted hover:text-foreground",
            )}
          >
            {tab.label}
            <span className="text-[0.6875rem] font-bold tabular-nums opacity-75">{tab.rows.length}</span>
          </button>
        ))}
      </div>

      {tabs.length > 2 && <p className="text-[0.625rem] text-muted">左右にスワイプでテーマを切り替えられます</p>}

      <div onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {active.rows.length === 0 ? (
          <p
            key={active.id}
            className="topic-tab-fade rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted"
          >
            {active.id === ALL_TAB_ID ? "まだ話題がありません。" : `「${active.label}」の話題はまだありません。`}
          </p>
        ) : (
          <section key={active.id} className="topic-tab-fade flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[0.8125rem] font-bold">
                {active.label}のニュース（{active.rows.length}件）
              </h2>
              <span className="text-[0.6875rem] text-muted">
                {unreadCount(active.rows, seenAt) > 0 ? `新着${unreadCount(active.rows, seenAt)}件・` : ""}取り込んだ順
                {active.id === ALL_TAB_ID && mergedCount > 0
                  ? `・同じ出来事${mergedCount}件を1件にまとめて表示`
                  : "・同じ出来事はまとめて表示"}
              </span>
            </div>
            <Timeline rows={active.rows} categories={categories} seenAt={seenAt} todayKey={todayKey} />
          </section>
        )}
      </div>
    </div>
  );
}

/** 取り込み回の見出しと、未読の境目の線を差し込んだ一覧（#418）。 */
function Timeline({
  rows,
  categories,
  seenAt,
  todayKey,
}: {
  rows: TopicRow[];
  categories: TopicCategory[];
  seenAt: Date | null;
  todayKey: string;
}) {
  const entries = useMemo(() => buildTimeline(rows, seenAt), [rows, seenAt]);
  return (
    <div className="flex flex-col">
      {entries.map((entry) => {
        if (entry.kind === "batch") {
          const dayKey = jstDayKey(entry.startedAt);
          const date = dayKey === todayKey ? "" : `${Number(dayKey.slice(5, 7))}/${Number(dayKey.slice(8, 10))} `;
          return (
            <div key={entry.key} className="flex items-center gap-2 pb-1.5 pt-3 text-[0.6875rem] text-muted first:pt-0">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-topic" />
              <b className="text-xs tabular-nums text-foreground">
                {date}
                {jstTimeLabel(entry.startedAt)}
              </b>
              <span>に取り込み・{entry.count}件</span>
              <span aria-hidden="true" className="h-px flex-1 bg-border" />
            </div>
          );
        }
        if (entry.kind === "seen") {
          return (
            <div key={entry.key} role="separator" className="flex items-center gap-2 py-1.5 text-[0.6875rem] font-bold text-accent">
              <span aria-hidden="true" className="h-0.5 flex-1 bg-accent/55" />
              <span className="whitespace-nowrap">ここまで未読（前回の続き）</span>
              <span aria-hidden="true" className="h-0.5 flex-1 bg-accent/55" />
            </div>
          );
        }
        return <TopicArticle key={entry.key} topic={entry.row} categories={categories} unread={entry.unread} />;
      })}
    </div>
  );
}

/**
 * 1件ぶん。見出し（出典へのリンク）・要点・秘書の一言・媒体の4段。
 *
 * 見出しと「開く」を1つのリンクにまとめる（`/notices` の `Title` と同じ理由）。出典は外部の
 * 記事なので常に新しいタブで開く。
 */
function TopicArticle({ topic, categories, unread }: { topic: TopicRow; categories: TopicCategory[]; unread: boolean }) {
  const meta = [topic.sourceName, topic.publishedOn].filter((part) => part !== "");

  return (
    <article
      className={cn(
        "flex flex-col gap-1 border-b border-border py-2.5 last:border-b-0 last:pb-0",
        unread && "-mx-2 rounded-md bg-accent-surface/60 px-2 shadow-[inset_3px_0_0_var(--accent)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {unread && <span className="shrink-0 text-[0.625rem] font-bold tracking-wider text-accent">NEW</span>}
        <span className="shrink-0 rounded-full bg-topic-surface px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-topic">
          {topicCategoryShort(categories, topic.category)}
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
          {jstTimeLabel(topic.fetchedAt)}に仕入れました
        </span>
      </div>
      <p className="m-0 text-[0.8125rem] leading-relaxed">{topic.summary}</p>
      {/* 吹き出しに出る一言。要約と見分けるため、引用の形にする。 */}
      <p className="m-0 border-l-2 border-topic/60 pl-2.5 text-[0.8125rem] leading-relaxed">
        <span className="mr-1.5 text-[0.625rem] tracking-wider text-muted">秘書の一言</span>
        {topic.lead}
      </p>
      {(meta.length > 0 || topic.alsoReported.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
          {topic.alsoReported.length > 0 && (
            <span className="rounded-md bg-accent-surface px-2 py-0.5 font-bold text-accent">
              {topic.alsoReported.length + 1}社が報道
            </span>
          )}
          {meta.map((part, index) => (
            <span key={part + index}>
              {index > 0 && <span className="mr-1.5 opacity-50">・</span>}
              {part}
            </span>
          ))}
        </div>
      )}
      {topic.alsoReported.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-1 rounded-lg border border-dashed border-border px-2.5 py-2 text-xs">
          <span className="text-[0.6875rem] text-muted">同じ出来事の他の記事</span>
          {topic.alsoReported.map((other, index) => (
            <div key={(other.url ?? other.title) + index} className="flex flex-col gap-0.5">
              {other.url ? (
                <a
                  href={other.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-muted underline-offset-[3px]"
                >
                  {other.title}
                </a>
              ) : (
                <span>{other.title}</span>
              )}
              {other.sourceName !== "" && <span className="text-[0.6875rem] text-muted">{other.sourceName}</span>}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
