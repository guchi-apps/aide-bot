import { redirect } from "next/navigation";

import { ChatShell } from "@/components/chat/chat-shell";
import { getCurrentUser } from "@/lib/auth-user";
import { conversationGroupLabel } from "@/lib/conversation";
import { db } from "@/lib/db";

// 一覧に出す件数の上限。これより古いものは、いまのところ辿る導線を持たない。
const CONVERSATION_LIMIT = 100;

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  const conversations = await db.conversation.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: CONVERSATION_LIMIT,
    select: { id: true, title: true, updatedAt: true },
  });

  const now = new Date();

  return (
    <ChatShell
      conversations={conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        group: conversationGroupLabel(conversation.updatedAt, now),
      }))}
      userLabel={user.name ?? user.email ?? "ログイン中"}
      userEmail={user.email}
    >
      {children}
    </ChatShell>
  );
}
