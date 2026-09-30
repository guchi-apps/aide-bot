import { redirect } from "next/navigation";

import { TopicsView } from "@/components/chat/topics-view";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { countSubscriptions } from "@/lib/push/subscriptions";
import { topicBoard } from "@/lib/topics";

// 仕入れるたびに変わるので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "話題" };

/**
 * 仕入れた話題の一覧（#144）。ログイン中の本人ぶんだけを出す。
 *
 * **この画面は取り出すだけで、仕入れは走らせない。** 仕入れの起点は「話す」画面の問い合わせ
 * （`/api/notices/current`）で、この画面を開いただけでは27秒の検索は始まらない。
 */
export default async function TopicsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 「◯時間前」を出すため、表示の基準になる時刻をサーバー側で決めて渡す。
  const now = new Date();
  const [board, schedules, deviceCount] = await Promise.all([
    topicBoard(user.id, now),
    db.scheduledPush.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, daysMask: true, hour: true, minute: true, category: true, enabled: true },
    }),
    countSubscriptions(user.id),
  ]);

  // 「前回開いた時刻」は読むだけで、ここでは更新しない（更新は画面が開いたときの1回のPOST。#418）。
  // ここで書くと、同じ画面の `router.refresh()` のたびに境目が消える。
  return (
    <TopicsView board={board} now={now} seenAt={user.topicsSeenAt} schedules={schedules} hasDevice={deviceCount > 0} />
  );
}
