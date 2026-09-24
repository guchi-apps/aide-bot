"use client";

import { BarChart3, Bell, Brain, CalendarDays, Newspaper, Settings } from "lucide-react";
import Link from "next/link";

import { AppIcon } from "@/components/brand/app-icon";
import { dayHeading, monthLabel } from "@/lib/day-key";
import { cn } from "@/lib/utils";

import type { DayRow } from "./types";

type Props = {
  /** 発言のある日を新しい順に並べたもの（#157）。 */
  days: DayRow[];
  /** いま開いている過去の日（`2026-09-01`）。今日の記録を開いているときはnull。 */
  activeDate: string | null;
  /** 今日の記録（`/`）を開いているか。 */
  isTodayActive: boolean;
  /** 今日の日付（`2026-09-03`）。一覧に無くても「今日」の行を出すために使う。 */
  todayKey: string;
  /** 使用量の画面を開いているか。相談は選ばれていない状態になる。 */
  isUsageActive: boolean;
  /** 設定の画面を開いているか。使用量と同じく、相談は選ばれていない状態になる（#46）。 */
  isSettingsActive: boolean;
  /** お知らせの画面を開いているか（#114）。 */
  isNoticesActive: boolean;
  /** まだ秘書が出していないお知らせの件数（#114）。0のときは数字を出さない。 */
  pendingNoticeCount: number;
  /** 話題の画面を開いているか（#144）。 */
  isTopicsActive: boolean;
  /** 記憶の画面を開いているか（#323）。 */
  isMemoryActive: boolean;
  /** 溜まっている話題の件数（#144）。0のときは数字を出さない。 */
  topicCount: number;
  /** 今月の概算費用（`$1.23` の形）。集計はサーバー側で済ませて文字列で受け取る。 */
  monthlyUsageLabel: string;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  onNavigate?: () => void;
};

/**
 * 日付の一覧（#157）。PCでは常に見えている左の帯、スマホではドロワーの中身として同じものを使う。
 *
 * **相談はテーマごとに分けなくなったので、並ぶのはスレッドではなく日付。** 押すとその日の
 * 記録（`/d/<date>`）が開く。今日の行だけは `/` を指す——話しかけられるのはそこだけで、
 * 同じ内容を2つのURLで出すと入力欄の有無が説明できなくなる。
 */
export function ConversationRail({
  days,
  activeDate,
  isTodayActive,
  todayKey,
  isUsageActive,
  isSettingsActive,
  isNoticesActive,
  pendingNoticeCount,
  isTopicsActive,
  isMemoryActive,
  topicCount,
  monthlyUsageLabel,
  userLabel,
  userEmail,
  appVersion,
  onNavigate,
}: Props) {
  // 今日の行は一覧に無くても必ず出す。一覧の元は発言なので、まだ何も話していない日は
  // 行が作られない——「今日」が消えると、続きを話す場所が左メニューから見えなくなる。
  const rows: DayRow[] =
    days[0]?.date === todayKey
      ? days
      : [
          {
            date: todayKey,
            heading: dayHeading(todayKey, todayKey),
            month: monthLabel(todayKey),
            count: 0,
          },
          ...days,
        ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-rail">
      <div className="flex flex-col gap-3.5 px-4 pb-3.5 pt-4">
        <div className="flex items-center gap-2.5 text-[0.9375rem] font-semibold">
          <AppIcon className="size-6" />
          秘書アプリ
        </div>

        {/*
          #157で「新しい相談」から「今日の記録」へ変わった。押しても新しいスレッドは
          作られず、続きを話す場所へ戻るだけ（`/` を開いている間は何も起きない）。
        */}
        <Link
          href="/"
          onClick={onNavigate}
          aria-current={isTodayActive ? "page" : undefined}
          className="flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-3 py-2.5 text-[0.8125rem] font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <CalendarDays className="size-3.5" aria-hidden="true" />
          今日の記録
        </Link>
      </div>

      <nav aria-label="日付ごとの記録" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        {rows.map((day, index) => {
          // 同じ月が続く間は見出しを出さない。並びは新しい順なので、月も順に切り替わる。
          const previousMonth = index === 0 ? null : rows[index - 1].month;
          const heading = day.month === previousMonth ? null : day.month;

          const isToday = day.date === todayKey;
          const isActive = isToday ? isTodayActive : day.date === activeDate;

          return (
            <div key={day.date}>
              {heading && (
                <div className="px-1.5 pb-1 pt-3.5 text-[0.6875rem] font-bold tracking-[0.1em] text-muted">
                  {heading}
                </div>
              )}
              <Link
                href={isToday ? "/" : `/d/${day.date}`}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  isActive && "bg-rail-active font-medium shadow-[inset_2px_0_0_var(--accent)]",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{day.heading}</span>
                {day.count > 0 && (
                  <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted">{day.count}</span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border">
        {/* 積まれたお知らせ（#114）。相談ではないので、使用量・設定と同じく下部に置く。
            未読は「秘書がまだ話していない件数」で、chatter.ts が数えているものと同じ。 */}
        <Link
          href="/notices"
          onClick={onNavigate}
          aria-current={isNoticesActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isNoticesActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <Bell className="size-3.5 text-muted" aria-hidden="true" />
            お知らせ
          </span>
          {pendingNoticeCount > 0 && (
            <span className="tabular-nums font-bold text-accent">未読 {pendingNoticeCount}</span>
          )}
        </Link>

        {/* 仕入れた話題（#144）。お知らせとは別の受け皿で、数字は「未読」ではなく溜まっている件数。
            用件ではないので、お知らせと違って数字を強調しない。 */}
        <Link
          href="/topics"
          onClick={onNavigate}
          aria-current={isTopicsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isTopicsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <Newspaper className="size-3.5 text-muted" aria-hidden="true" />
            話題
          </span>
          {topicCount > 0 && <span className="tabular-nums text-xs font-medium text-muted">{topicCount}件</span>}
        </Link>

        {/* 継続記憶（#323）。会話の要約とは別に、本人が残すと選んだ希望・決定を見直す画面。 */}
        <Link
          href="/memory"
          onClick={onNavigate}
          aria-current={isMemoryActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isMemoryActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Brain className="size-3.5 text-muted" aria-hidden="true" />
          記憶
        </Link>

        {/* 返答のモデル（#71）と外部サービスとの接続（#46）。相談ではないので、一覧ではなく下部に置く。 */}
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={isSettingsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isSettingsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Settings className="size-3.5 text-muted" aria-hidden="true" />
          設定
        </Link>

        {/* APIの消費量（#51）。1つの数字だけを一覧に出し、内訳は専用の画面で見る。
            出るのは従量課金ぶんの金額か、それが0のときは定額ぶんの回数（#133）。 */}
        <Link
          href="/usage"
          onClick={onNavigate}
          aria-current={isUsageActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isUsageActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="size-3.5 text-muted" aria-hidden="true" />
            使用量
          </span>
          <span className="tabular-nums font-bold text-accent">今月 {monthlyUsageLabel}</span>
        </Link>

        <div className="flex items-center justify-between gap-2.5 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <b className="block text-[0.8125rem] font-medium">{userLabel}</b>
            {userEmail && <span className="block truncate text-[0.6875rem] text-muted">{userEmail}</span>}
          </div>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active"
            >
              ログアウト
            </button>
          </form>
        </div>

        {/* どの版を見ているかが画面だけで分かるようにする。値は package.json の version。 */}
        <p className="px-4 pb-3 text-[0.6875rem] text-muted">v{appVersion}</p>
      </div>
    </div>
  );
}
