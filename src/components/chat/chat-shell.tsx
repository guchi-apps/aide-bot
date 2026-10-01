"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";


import { ConversationRail } from "./conversation-rail";
import type { DayRow } from "./types";
import { useSwipeDrawer } from "./use-swipe-drawer";
import { useVisualViewportFit } from "./use-visual-viewport";

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
 *
 * **ページそのものが上下にスクロールしないことの担保は `html`/`body`（`src/app/layout.tsx`）
 * 側の `overflow-hidden`・`overscroll-none` が持つ**（#191）。この`ChatShell`のルートに
 * ある `overflow-hidden` は、この中で内容が縦に収まりきらないときの見た目のクリップ用で、
 * iOSのタッチのラバーバンド（弾性スクロール）まではデスクトップの検証では再現できず、
 * `html`/`body` 側で塞ぐ必要があった。各画面の内部スクロール（一覧・記録欄・設定パネル等）は
 * `overflow-y-auto` の入れ物ごとに閉じているので、ここを固定しても壊れない。
 *
 * 高さの元は `--app-height`（ふだんは100dvh）と `--app-bottom-inset`（`globals.css`）。
 * 画面キーボードが出ている間は `useVisualViewportFit()` がキーボードの上に残る高さへ縮める
 * （#379。iOSでキーボードを閉じた後にページが持ち上がったまま残るのを防ぐ）。
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
  useVisualViewportFit();
  // 右スワイプで開き、左スワイプで閉じる（#434）。触っている間だけ指に追従する開き具合が入る。
  const drawerRef = useRef<HTMLDivElement>(null);
  const dragProgress = useSwipeDrawer({
    open: drawerOpen,
    onOpenChange: setDrawerOpen,
    getWidth: () => drawerRef.current?.offsetWidth ?? 0,
  });
  const openAmount = dragProgress ?? (drawerOpen ? 1 : 0);

  const isUsage = pathname === "/usage";
  // 過去の日（`/d/<date>`。#157）。今日の記録は `/` で、この形のURLを持たない。
  const activeDate = pathname.startsWith("/d/") ? pathname.slice("/d/".length) : null;
  const isToday = pathname === "/";
  const isSettings = pathname === "/settings";
  const isNotices = pathname === "/notices";
  const isTopics = pathname === "/topics";
  const isMemory = pathname === "/memory";
  const isModels = pathname === "/models";
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
          : isMemory
            ? "記憶"
            : isModels
            ? "モデル"
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
    <div className="flex h-[calc(var(--app-height)_-_var(--app-bottom-inset))] w-full overflow-hidden">
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
          isMemoryActive={isMemory}
          isModelsActive={isModels}
          pendingNoticeCount={pendingNoticeCount}
          topicCount={topicCount}
          monthlyUsageLabel={monthlyUsageLabel}
          userLabel={userLabel}
          userEmail={userEmail}
          appVersion={appVersion}
        />
      </aside>

      {/* 閉じている間も描画して位置だけ動かす（#434。指に追従させるため）。`inert` で操作もフォーカスも止める。 */}
      <div className="md:hidden" inert={!drawerOpen && dragProgress === null}>
          <button
            type="button"
            aria-label="日付の一覧を閉じる"
            tabIndex={drawerOpen ? 0 : -1}
            onClick={() => setDrawerOpen(false)}
            // ライト・ダークのどちらでも背後を沈ませたいので、テーマ変数ではなく黒を敷く。
            className={cn(
              "fixed inset-0 z-40 bg-black/50",
              dragProgress === null && "transition-opacity duration-200 motion-reduce:transition-none",
            )}
            style={{ opacity: openAmount, pointerEvents: openAmount > 0 ? "auto" : "none" }}
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="日付の一覧"
            className={cn(
              "fixed inset-y-0 left-0 z-50 w-[calc(100%_-_72px)] max-w-[320px] border-r border-border",
              openAmount > 0 && "shadow-2xl",
              dragProgress === null && "transition-transform duration-200 motion-reduce:transition-none",
            )}
            style={{ transform: `translateX(${(openAmount - 1) * 100}%)` }}
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
          isMemoryActive={isMemory}
              isModelsActive={isModels}
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

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2.5 border-b border-border bg-surface px-3 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.625rem)] md:bg-transparent md:px-7 md:py-3.5">
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

        </header>

        {children}
      </div>
    </div>
  );
}
