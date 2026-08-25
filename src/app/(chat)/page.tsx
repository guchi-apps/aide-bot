import { ConversationView } from "@/components/chat/conversation-view";

/** 新しい相談。最初の送信でスレッドが作られ、`/c/<ID>` へ移る。 */
export default function NewConversationPage() {
  return <ConversationView conversationId={null} initialMessages={[]} />;
}
