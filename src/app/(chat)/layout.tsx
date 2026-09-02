import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ChatShell } from "@/components/chat/chat-shell";
import { TalkModeProvider } from "@/components/chat/talk-mode-context";
import { APP_VERSION } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/auth-user";
import { conversationGroupLabel } from "@/lib/conversation";
import { db } from "@/lib/db";
import { pendingNoticeCount } from "@/lib/notice-list";
import { TALK_MODE_COOKIE, normalizeTalkMode } from "@/lib/talk-mode";
import { formatUsd, startOfMonth, usageBreakdown, type UsageBreakdown } from "@/lib/usage";

// 一覧に出す件数の上限。これより古いものは、いまのところ辿る導線を持たない。
const CONVERSATION_LIMIT = 100;

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  const now = new Date();

  // 今月の使用量（#51・#133）。一覧の下に出すため、相談の画面でも毎回引くことになる。
  // モデル別に集計した数行しか返らないので、一覧の取得と一緒に流して待ち時間を足さない。
  const monthlyUsagePromise = usageBreakdown({ userId: user.id, since: startOfMonth(now) });

  // まだ秘書が出していないお知らせの件数（#114）。使用量と同じく相談の画面でも毎回引くことに
  // なるが、`count` 1本なので一覧の取得と一緒に流して待ち時間を足さない。
  const pendingNoticesPromise = pendingNoticeCount(user.id, now);

  const conversations = await db.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: CONVERSATION_LIMIT,
    select: { id: true, title: true, updatedAt: true },
  });

  // 最初の描画からモードを確定させたいのでCookieから読む。クライアント側で決めると、
  // 「書く」を選んでいる人にも一瞬だけ音声画面が出る。
  const mode = normalizeTalkMode((await cookies()).get(TALK_MODE_COOKIE)?.value);
  const [monthlyUsage, pendingNotices] = await Promise.all([
    monthlyUsagePromise,
    pendingNoticesPromise,
  ]);

  return (
    <TalkModeProvider initialMode={mode}>
      <ChatShell
        conversations={conversations.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          group: conversationGroupLabel(conversation.updatedAt, now),
        }))}
        monthlyUsageLabel={monthlyUsageLabel(monthlyUsage)}
        pendingNoticeCount={pendingNotices}
        userLabel={user.name ?? user.email ?? "ログイン中"}
        userEmail={user.email}
        appVersion={APP_VERSION}
      >
        {children}
      </ChatShell>
    </TalkModeProvider>
  );
}

/**
 * 左メニューに出す今月の一言（#133）。
 *
 * **従量課金ぶんの費用があるうちは金額、無くなったら定額ぶんの回数を出す。** チャットも
 * お知らせ選定もCodexへ移り、#131で朝の見通しまで移ると従量課金ぶんは0になる。そのとき
 * 金額だけを出し続けると、実際には毎日使っているのに「今月 $0.00」が並び、使っていないように
 * 読める。**費用が出ている間は金額を優先する**——出ている額を隠す方が分かりにくい。
 */
function monthlyUsageLabel(usage: UsageBreakdown): string {
  if (usage.metered.costUsd > 0) return formatUsd(usage.metered.costUsd);
  return `${usage.subscription.calls}回`;
}
