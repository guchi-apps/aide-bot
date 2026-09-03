"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { ConversationRail } from "./conversation-rail";
import { useTalkMode } from "./talk-mode-context";
import type { DayRow } from "./types";

type Props = {
  /** 発言のある日を新しい順に並べたもの（#157）。 */
  days: DayRow[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。 */
  todayKey: string;
  /** 今月の概算費用（`$1.23` の形）。一覧の下に出す（#51）。 */
  monthlyUsageLabel: string;
  /** まだ秘書が出していないお知らせの件数（#114）。一覧の下のバッジに出す。 */
  pendingNoticeCount: number;
  /** 溜まっている話題の件数（#144）。一覧の下に出す。 */
  topicCount: number;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  children: React.ReactNode;
};

/**
 * チャット画面の外枠。日付の一覧（PCは常設の帯、スマホはドロワー）と上部の見出しを持つ。
 *
 * 高さから `env(safe-area-inset-bottom)` を引いているのは、body側で同じぶんの余白を
 * 取っているため。100dvhのままだと合計が画面より高くなり、ページ全体が数十pxだけ
 * 縦スクロールする（ホーム画面から起動したiOSで顕著）。
 */
export function ChatShell({
  days,
  todayKey,
  monthlyUsageLabel,
  pendingNoticeCount,
  topicCount,
  userLabel,
  userEmail,
  appVersion,
  children,
}: Props) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isUsage = pathname === "/usage";
  // 過去の日（`/d/<date>`。#157）。今日の記録は `/` で、この形のURLを持たない。
  const activeDate = pathname.startsWith("/d/") ? pathname.slice("/d/".length) : null;
  const isToday = pathname === "/";
  const isSettings = pathname === "/settings";
  const isNotices = pathname === "/notices";
  const isTopics = pathname === "/topics";
  // 開いている日の見出し。一覧に無い日（記録を消した直後など）でも空にしないよう、
  // 見つからなければ日付そのものを出す。
  const activeDayHeading = activeDate
    ? (days.find((day) => day.date === activeDate)?.heading ?? activeDate)
    : null;
  // 使用量（#51）・設定（#46・#71）・お知らせ（#114）・話題（#144）は記録ではないので、見出しも
  // 「話す / 書く」の切り替えもこれらの画面には出さない。
  const heading = isUsage
    ? "使用量"
    : isSettings
      ? "設定"
      : isNotices
        ? "お知らせ"
        : isTopics
          ? "話題"
          : activeDayHeading
            ? `${activeDayHeading}の記録`
            : "今日の記録";

  // 開いたドロワーは、閉じるボタン・スクリム・中のリンク（onNavigate）で閉じる。
  // pathnameの変化をuseEffectで見て閉じる形にはしない——描画のたびにsetStateが走る。

  useEffect(() => {
    if (!drawerOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="flex h-[calc(100dvh_-_env(safe-area-inset-bottom))] w-full overflow-hidden">
      <aside className="hidden w-[276px] shrink-0 border-r border-border md:block">
        <ConversationRail
          days={days}
          activeDate={activeDate}
          isTodayActive={isToday}
          todayKey={todayKey}
          isUsageActive={isUsage}
          isSettingsActive={isSettings}
          isNoticesActive={isNotices}
          isTopicsActive={isTopics}
          pendingNoticeCount={pendingNoticeCount}
          topicCount={topicCount}
          monthlyUsageLabel={monthlyUsageLabel}
          userLabel={userLabel}
          userEmail={userEmail}
          appVersion={appVersion}
        />
      </aside>

      {drawerOpen && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="日付の一覧を閉じる"
            onClick={() => setDrawerOpen(false)}
            // ライト・ダークのどちらでも背後を沈ませたいので、テーマ変数ではなく黒を敷く。
            className="fixed inset-0 z-40 bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="日付の一覧"
            className="fixed inset-y-0 left-0 z-50 w-[calc(100%_-_72px)] max-w-[320px] border-r border-border shadow-2xl"
          >
            <ConversationRail
              days={days}
              activeDate={activeDate}
              isTodayActive={isToday}
              todayKey={todayKey}
              isUsageActive={isUsage}
              isSettingsActive={isSettings}
              isNoticesActive={isNotices}
              isTopicsActive={isTopics}
              pendingNoticeCount={pendingNoticeCount}
              topicCount={topicCount}
              monthlyUsageLabel={monthlyUsageLabel}
              userLabel={userLabel}
              userEmail={userEmail}
              appVersion={appVersion}
              onNavigate={() => setDrawerOpen(false)}
            />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="absolute right-2 top-2 grid size-9 place-items-center rounded-lg text-muted transition-colors hover:bg-rail-active"
            >
              <X className="size-4" aria-hidden="true" />
              <span className="sr-only">閉じる</span>
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-border bg-surface px-3 py-2.5 md:bg-transparent md:px-7 md:py-3.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-border bg-background transition-colors hover:bg-rail-active md:hidden"
          >
            <Menu className="size-4" aria-hidden="true" />
            <span className="sr-only">日付の一覧を開く</span>
          </button>

          <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium md:text-left md:text-[0.9375rem]">
            {heading}
          </h1>

          {/* 過去の日（#157）は読むだけなので、話す／書くの切り替えも出さない。 */}
          {isToday && <TalkModeSwitch />}
        </header>

        {children}
      </div>
    </div>
  );
}

/**
 * 「話す / 書く」の切り替え。既定は「話す」で、選んだ方はCookieに残る（#27）。
 *
 * スマホでは左の一覧を開くボタンと並べて置いている。**出るのは今日の記録の画面だけ**
 * （#157）——過去の日も、使用量・設定・お知らせ・話題も読むだけの画面で、切り替えても
 * 何も変わらない。
 */
function TalkModeSwitch() {
  const { mode, setMode } = useTalkMode();

  return (
    <div
      role="group"
      aria-label="話しかけかた"
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-rail-active p-0.5"
    >
      {(["voice", "write"] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          onClick={() => setMode(candidate)}
          aria-pressed={mode === candidate}
          className={cn(
            "rounded-full px-3.5 py-1.5 text-xs transition-colors",
            mode === candidate
              ? "bg-surface font-bold text-foreground shadow-sm"
              : "text-muted hover:text-foreground",
          )}
        >
          {candidate === "voice" ? "話す" : "書く"}
        </button>
      ))}
    </div>
  );
}
