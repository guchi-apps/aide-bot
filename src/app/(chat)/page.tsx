import { ChatPanel } from "@/components/chat/chat-panel";

/** 新しい相談。最初の送信でスレッドが作られ、`/c/<ID>` へ移る。 */
export default function NewConversationPage() {
  return <ChatPanel conversationId={null} initialMessages={[]} />;
}
