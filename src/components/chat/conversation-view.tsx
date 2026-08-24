"use client";

import { VoicePanel } from "@/components/voice/voice-panel";

import { ChatPanel } from "./chat-panel";
import { useTalkMode } from "./talk-mode-context";
import type { ChatMessage } from "./types";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  initialMessages: ChatMessage[];
};

/**
 * 相談1件の中身。「話す」と「書く」で見た目も操作も変わるが、扱うスレッドは同じ。
 *
 * `key` を分けているのは、切り替えたときに前のモードの状態（聞き取り中・入力途中）を
 * 残さず作り直すため。どちらも表示の元は同じ `initialMessages` で、直前のやり取りは
 * 送信のたびの `router.refresh()` で取り直されている。
 */
export function ConversationView({ conversationId, initialMessages }: Props) {
  const { mode } = useTalkMode();

  return mode === "voice" ? (
    <VoicePanel key="voice" conversationId={conversationId} initialMessages={initialMessages} />
  ) : (
    <ChatPanel key="write" conversationId={conversationId} initialMessages={initialMessages} />
  );
}
