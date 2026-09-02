import { redirect } from "next/navigation";

import { TopicsView } from "@/components/chat/topics-view";
import { getCurrentUser } from "@/lib/auth-user";
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
  const board = await topicBoard(user.id, now);

  return <TopicsView board={board} now={now} />;
}
