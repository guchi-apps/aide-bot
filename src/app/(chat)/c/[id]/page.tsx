import { redirect } from "next/navigation";

import { ConversationView } from "@/components/chat/conversation-view";
import type { ChatEntry } from "@/components/chat/types";
import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";

/**
 * 発言と、書き込みの道具を使った記録（#81）を時刻順に1本へ均す。
 *
 * 記録は `Message` とは別のテーブルにある（#46「保存するのは本文だけ」を崩さないため）ので、
 * 並べ直すのは読み出す側の仕事になる。`ToolCall.createdAt` には**呼んだ時点の時刻**が
 * 入っている（行を作るのは返答を保存した後）ため、同じ往復では
 * 利用者の発言 → 書き込みの記録 → 秘書の返答 の順に落ち着く。
 *
 * 時刻が並んだときは記録を先に置く。書き込みは必ず、その往復の返答より前に起きている。
 */
function mergeEntries(
  messages: { id: string; role: "USER" | "ASSISTANT"; content: string; interrupted: boolean; createdAt: Date }[],
  toolCalls: {
    id: string;
    serverLabel: string;
    toolName: string;
    input: string;
    output: string | null;
    failed: boolean;
    createdAt: Date;
  }[],
): ChatEntry[] {
  const rows: { at: number; tie: number; entry: ChatEntry }[] = [
    ...messages.map((message) => ({
      at: message.createdAt.getTime(),
      tie: 1,
      entry: {
        kind: "message" as const,
        id: message.id,
        role: message.role,
        content: message.content,
        interrupted: message.interrupted,
      },
    })),
    ...toolCalls.map((call) => ({
      at: call.createdAt.getTime(),
      tie: 0,
      entry: {
        kind: "tool" as const,
        id: call.id,
        server: call.serverLabel,
        tool: call.toolName,
        input: call.input,
        output: call.output,
        failed: call.failed,
      },
    })),
  ];

  return rows.sort((a, b) => a.at - b.at || a.tie - b.tie).map((row) => row.entry);
}

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
        select: { id: true, role: true, content: true, interrupted: true, createdAt: true },
      },
      // 書き込みの道具を使った記録（#81）。発言と混ぜて出すため一緒に引く。
      toolCalls: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          serverLabel: true,
          toolName: true,
          input: true,
          output: true,
          failed: true,
          createdAt: true,
        },
      },
    },
  });

  // 消した相談のURLへ着地したときは、既定の404ではなく新しい相談へ送る（#102）。
  // 相談を消せるようになったことで `/c/<ID>` は初めて「実在しなくなるURL」になり、
  // 朝の見通し（#79）のWeb Pushは端末側のペイロードにこの形のURLを持っている
  // （`NotificationLog.conversationId` はFKの無いただの列なので、消した後も同じURLを開く）。
  // このリポジトリには `not-found.tsx` が無く、404では左メニューごと消えてアプリへ戻れない。
  if (!conversation) {
    redirect("/");
  }

  return (
    <ConversationView
      conversationId={conversation.id}
      initialEntries={mergeEntries(conversation.messages, conversation.toolCalls)}
    />
  );
}
