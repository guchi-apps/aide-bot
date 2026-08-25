"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { AppIcon } from "@/components/app-icon";
import { cn } from "@/lib/utils";

import type { ConversationSummary } from "./types";

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  userLabel: string;
  userEmail: string | null;
  onNavigate?: () => void;
};

/**
 * 相談の一覧。PCでは常に見えている左の帯、スマホではドロワーの中身として同じものを使う。
 */
export function ConversationRail({
  conversations,
  activeId,
  userLabel,
  userEmail,
  onNavigate,
}: Props) {
  let lastGroup: string | null = null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-rail">
      <div className="flex flex-col gap-3.5 px-4 pb-3.5 pt-4">
        <div className="flex items-center gap-2.5 text-[0.9375rem] font-semibold">
          <AppIcon className="size-6" />
          秘書アプリ
        </div>

        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-3 py-2.5 text-[0.8125rem] font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          新しい相談
        </Link>
      </div>

      <nav aria-label="過去の相談" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted">
            まだ相談がありません。下の入力欄から話しかけてください。
          </p>
        ) : (
          conversations.map((conversation) => {
            // 同じ見出しが続く間は出さない。並びは更新が新しい順なので、グループも順に切り替わる。
            const heading = conversation.group === lastGroup ? null : conversation.group;
            lastGroup = conversation.group;

            return (
              <div key={conversation.id}>
                {heading && (
                  <div className="px-1.5 pb-1 pt-3.5 text-[0.6875rem] font-bold tracking-[0.1em] text-muted">
                    {heading}
                  </div>
                )}
                <Link
                  href={`/c/${conversation.id}`}
                  onClick={onNavigate}
                  aria-current={conversation.id === activeId ? "page" : undefined}
                  className={cn(
                    "block truncate rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    conversation.id === activeId &&
                      "bg-rail-active font-medium shadow-[inset_2px_0_0_var(--accent)]",
                  )}
                >
                  {conversation.title}
                </Link>
              </div>
            );
          })
        )}
      </nav>

      <div className="flex items-center justify-between gap-2.5 border-t border-border px-4 py-3">
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
    </div>
  );
}
