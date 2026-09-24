import { redirect } from "next/navigation";

import { MemoryView } from "@/components/chat/memory-view";
import { getCurrentUser } from "@/lib/auth-user";
import { listMemories } from "@/lib/memory";
import { hasNotionConnection } from "@/lib/home-profile";
import { listConnectedServers } from "@/lib/mcp/connections";

export const dynamic = "force-dynamic";

export const metadata = { title: "記憶" };

/**
 * 継続記憶の一覧（#323）。候補を確かめて残す・直す・見送る、確定を忘れる、を選ぶ画面。
 * **取り出すだけで、抽出もNotionの照合も走らせない**（走るのは返答の後とボタンを押したとき）。
 */
export default async function MemoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const now = new Date();
  const memories = await listMemories(user.id);

  let notionConnected = false;
  try {
    notionConnected = hasNotionConnection((await listConnectedServers(user.id)).map((server) => server.url));
  } catch {
    // 読み出せなかった回は「繋いでいない」と案内するだけで、画面そのものは出す。
  }

  return (
    <MemoryView
      now={now.toISOString()}
      notionConnected={notionConnected}
      memories={memories.map((memory) => ({
        id: memory.id,
        kind: memory.kind,
        content: memory.content,
        status: memory.status,
        confidence: memory.confidence,
        sourceQuote: memory.sourceQuote,
        sourceAt: memory.sourceAt.toISOString(),
        updatedAt: memory.updatedAt.toISOString(),
        notionStatus: memory.notionStatus,
        notionUrl: memory.notionUrl,
        notionCheckedAt: memory.notionCheckedAt?.toISOString() ?? null,
      }))}
    />
  );
}
