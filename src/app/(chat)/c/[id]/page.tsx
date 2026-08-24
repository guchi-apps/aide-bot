import { notFound, redirect } from "next/navigation";

import { ChatPanel } from "@/components/chat/chat-panel";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // 他人のスレッドをIDだけで開けないよう、userIdとの組で引く。
  const conversation = await db.conversation.findFirst({
    where: { id, userId: user.id },
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true },
      },
    },
  });

  if (!conversation) {
    notFound();
  }

  return <ChatPanel conversationId={conversation.id} initialMessages={conversation.messages} />;
}
