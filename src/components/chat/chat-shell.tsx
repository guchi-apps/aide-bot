"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { ConversationRail } from "./conversation-rail";
import { useTalkMode } from "./talk-mode-context";
import type { ConversationSummary } from "./types";

type Props = {
  conversations: ConversationSummary[];
  /** 今月の概算費用（`$1.23` の形）。一覧の下に出す（#51）。 */
  monthlyCostLabel: string;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  children: React.ReactNode;
};

/**
 * チャット画面の外枠。相談の一覧（PCは常設の帯、スマホはドロワー）と上部の見出しを持つ。
 *
 * 高さから `env(safe-area-inset-bottom)` を引いているのは、body側で同じぶんの余白を
 * 取っているため。100dvhのままだと合計が画面より高くなり、ページ全体が数十pxだけ
 * 縦スクロールする（ホーム画面から起動したiOSで顕著）。
 */
export function ChatShell({
  conversations,
  monthlyCostLabel,
  userLabel,
  userEmail,
  appVersion,
  children,
}: Props) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const isUsage = pathname === "/usage";
  const activeId = pathname.startsWith("/c/") ? pathname.slice("/c/".length) : null;
  const isSettings = pathname === "/settings";
  const activeTitle = conversations.find((c) => c.id === activeId)?.title ?? "新しい相談";
  // 使用量（#51）と設定（#46・#71）は相談ではないので、見出しも「話す / 書く」の切り替えも
  // これらの画面には出さない。
  const heading = isUsage ? "使用量" : isSettings ? "設定" : activeTitle;

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
          conversations={conversations}
          activeId={activeId}
          isUsageActive={isUsage}
          isSettingsActive={isSettings}
          monthlyCostLabel={monthlyCostLabel}
          userLabel={userLabel}
          userEmail={userEmail}
          appVersion={appVersion}
        />
      </aside>

      {drawerOpen && (
        <div className="md:hidden">
          <button
            type="button"
            aria-label="相談の一覧を閉じる"
            onClick={() => setDrawerOpen(false)}
            // ライト・ダークのどちらでも背後を沈ませたいので、テーマ変数ではなく黒を敷く。
            className="fixed inset-0 z-40 bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="相談の一覧"
            className="fixed inset-y-0 left-0 z-50 w-[calc(100%_-_72px)] max-w-[320px] border-r border-border shadow-2xl"
          >
            <ConversationRail
              conversations={conversations}
              activeId={activeId}
              isUsageActive={isUsage}
              isSettingsActive={isSettings}
              monthlyCostLabel={monthlyCostLabel}
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
            <span className="sr-only">相談の一覧を開く</span>
          </button>

          <h1 className="min-w-0 flex-1 truncate text-center text-sm font-medium md:text-left md:text-[0.9375rem]">
            {heading}
          </h1>

          {!isUsage && !isSettings && <TalkModeSwitch />}
        </header>

        {children}
      </div>
    </div>
  );
}

/**
 * 「話す / 書く」の切り替え。既定は「話す」で、選んだ方はCookieに残る（#27）。
 *
 * スマホでは「新しい相談」のボタンがあった位置に置いている。相談を分けるより、
 * 話すか書くかを切り替える方が桁違いに多い操作のため。新しい相談は左の一覧から作る。
 */
function TalkModeSwitch() {
  const { mode, setMode } = useTalkMode();

  return (
    <div
      role="group"
      aria-label="相談のしかた"
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
