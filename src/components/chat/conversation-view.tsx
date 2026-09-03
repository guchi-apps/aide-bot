"use client";

import { VoicePanel } from "@/components/voice/voice-panel";
import { useNewConversationEpoch } from "@/lib/new-conversation";

import { ChatPanel } from "./chat-panel";
import { useTalkMode } from "./talk-mode-context";
import type { ChatEntry } from "./types";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
};

/**
 * 相談1件の中身。「話す」と「書く」で見た目も操作も変わるが、扱うスレッドは同じ。
 *
 * `key` を分けているのは、切り替えたときに前のモードの状態（聞き取り中・入力途中）を
 * 残さず作り直すため。どちらも表示の元は同じ `initialEntries` で、直前のやり取りは
 * 送信のたびの `router.refresh()` で取り直されている。
 *
 * **`key` には「新しい相談」を押した回数も混ぜる（#155）。** 左メニューのそれは `/` への
 * リンクで、`/` を開いている間はルートが変わらないため、これが無いと画面が作り直されず、
 * 押した後に話しかけた内容がさっきまでの相談へ足される（`@/lib/new-conversation`）。
 */
export function ConversationView({ conversationId, initialEntries }: Props) {
  const { mode } = useTalkMode();
  const epoch = useNewConversationEpoch();

  return mode === "voice" ? (
    <VoicePanel
      key={`voice-${epoch}`}
      conversationId={conversationId}
      initialEntries={initialEntries}
    />
  ) : (
    <ChatPanel
      key={`write-${epoch}`}
      conversationId={conversationId}
      initialEntries={initialEntries}
    />
  );
}
