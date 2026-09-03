import { redirect } from "next/navigation";

import { ConversationView } from "@/components/chat/conversation-view";
import { getCurrentUser } from "@/lib/auth-user";
import { jstDayKey } from "@/lib/day-key";
import { entriesForToday, primaryConversation } from "@/lib/day-log";

/**
 * 今日の記録（#157）。連続セッションの続きで、話しかけられるのはこの画面だけ。
 *
 * 相談はテーマごとに分けなくなったので、**ここは「新しい相談」ではなく「いまの続き」**。
 * 今日まだ何も話していない日はきのう以前から少し引き継いで出す（`entriesForToday()`）
 * ——毎朝まっさらだと、1本の記録が続いているように見えない。
 */
export default async function TodayPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const conversation = await primaryConversation(user.id);

  const entries = await entriesForToday(conversation.id, now);

  return (
    <ConversationView
      initialEntries={entries}
      todayKey={jstDayKey(now)}
      compactedCount={conversation.summarizedCount}
    />
  );
}
