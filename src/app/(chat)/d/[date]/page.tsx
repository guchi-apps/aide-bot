import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EntryList } from "@/components/chat/entry-list";
import { getCurrentUser } from "@/lib/auth-user";
import { isDayKey, jstDayKey } from "@/lib/day-key";
import { entriesForDay, primaryConversation } from "@/lib/day-log";

/**
 * 過去の1日ぶんの記録（#157）。**読むだけの画面。**
 *
 * 入力欄を置かないのは、送った発言が必ず「今日」へ積まれるため——過去の日の画面から
 * 話しかけられると、押した日と出る場所がずれる。続きは「今日へ戻る」から。
 *
 * 今日の日付で開かれたら `/` へ送る。同じ内容が2つのURLで出ると、片方には入力欄があり
 * 片方には無い、という説明の付かない画面になる。
 */
export default async function DayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // URLから来た値。日付として読めないものは、存在しない日と同じく今日へ送る
  // （このリポジトリには `not-found.tsx` が無く、404では左メニューごと消えてアプリへ
  // 戻る導線が無くなる。#102と同じ理由）。
  if (!isDayKey(date) || date >= jstDayKey(new Date())) {
    redirect("/");
  }

  const conversation = await primaryConversation(user.id);
  const entries = await entriesForDay(conversation.id, date);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 md:px-7 md:py-6">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-sm leading-relaxed text-muted">
              この日の記録は残っていません。
            </p>
          ) : (
            <EntryList entries={entries} todayKey={jstDayKey(new Date())} />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3.5 md:px-7 md:py-4">
        <p className="text-xs text-muted">
          この日の記録は読むだけです。話しかけるときは今日へ戻ってください。
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          今日へ戻る
        </Link>
      </div>
    </div>
  );
}
