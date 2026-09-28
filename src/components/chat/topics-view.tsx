import { jstTimeLabel } from "@/lib/day-key";
import type { TopicBoard } from "@/lib/topics";

import { TopicCategoryPicker } from "./topic-category-picker";
import { TopicTabs } from "./topic-tabs";

type Props = {
  board: TopicBoard;
  /** 描画の基準になる時刻。「◯時間前」の計算に使う（サーバー側で決めて渡す）。 */
  now: Date;
};

/**
 * 仕入れた話題の一覧（#144）。
 *
 * `/notices` と同じくサーバーコンポーネントのまま置き、テーマ別タブ・種類を選ぶ部品だけを
 * クライアントにする（#404）。並べる順は新しい順。まずニュースをまとめて読めるようにし、
 * 仕入れる種類の管理は必要なときだけ開く。
 */
export function TopicsView({ board, now }: Props) {
  const { categories, lastFetchedAt, topics, byCategory, mergedCount, bubbleLimit, lifetimeHours } = board;

  const enabledCategories = categories.filter((category) => category.enabled);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-bold tracking-tight">いまの話題</h2>
          <span className="text-[0.6875rem] text-muted">
            {lastFetchedAt
              ? `最終取得 ${jstTimeLabel(lastFetchedAt)}（${elapsedLabel(lastFetchedAt, now)}）`
              : enabledCategories.length === 0
                ? "仕入れを止めています"
                : "「話す」画面を開くと仕入れます"}
          </span>
        </div>

        {topics.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            {enabledCategories.length === 0
              ? "仕入れを止めています。下の種類を1つ以上チェックすると、次に「話す」画面を開いたときに仕入れます。"
              : "まだ話題がありません。「話す」画面を開くと仕入れが始まり、30秒ほどで並びます（画面は読み込み直してください）。"}
          </p>
        ) : (
          <TopicTabs categories={categories} allTopics={topics} byCategory={byCategory} mergedCount={mergedCount} />
        )}

        <details className="group rounded-xl border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0 text-accent transition-transform group-open:rotate-90"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            <span className="text-[0.8125rem] font-bold">仕入れる種類</span>
            <span className="ml-auto text-right text-[0.6875rem] text-muted">
              {enabledCategories.length > 0 ? `${enabledCategories.length}種類を仕入れ中・管理する` : "仕入れを止めています・管理する"}
            </span>
          </summary>
          <div className="border-t border-border px-4 py-3.5">
            <p className="mb-3 text-[0.6875rem] leading-relaxed text-muted">
              チェックした種類だけを、アプリを開いたときにウェブで調べます。
            </p>
            <TopicCategoryPicker initial={categories} />
          </div>
        </details>

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

/** 「3分前」「2時間前」。 */
function elapsedLabel(date: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));
  if (minutes < 1) return "たったいま";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}
