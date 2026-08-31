import { redirect } from "next/navigation";

import { NoticesView } from "@/components/chat/notices-view";
import { getCurrentUser } from "@/lib/auth-user";
import { noticeBoard } from "@/lib/notice-list";
import { NOTICE_DISPLAY_TTL_MS } from "@/lib/notices";

// 積まれるたびに変わるので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "お知らせ" };

/**
 * 積まれたお知らせの一覧（#114）。ログイン中の本人ぶんだけを出す。
 *
 * **この画面は取り出すだけで、選定には関わらない。** `/api/notices/current` と違って
 * モデルを呼ばず、`shownAt` も書かない——開いただけで候補が消費されると、吹き出しに
 * 出るはずだったお知らせが画面を見た人にだけ届いて終わる。
 */
export default async function NoticesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 「あと◯分」を出すため、表示の基準になる時刻をサーバー側で決めて渡す。
  const now = new Date();
  const board = await noticeBoard(user.id, now);

  return <NoticesView board={board} now={now} displayTtlMs={NOTICE_DISPLAY_TTL_MS} />;
}
