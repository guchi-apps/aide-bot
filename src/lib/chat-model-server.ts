import { cookies } from "next/headers";

import {
  CHAT_MODEL_COOKIE,
  normalizeChatModel,
  type ChatModelId,
  type ReplyStyle,
} from "@/lib/chat-model";

/**
 * この端末が選んでいるモデルをCookieから読む（#71）。
 *
 * **サーバー専用。** `next/headers` はクライアント側のビルドに入れられないため、
 * モデルの定義（`src/lib/chat-model.ts`）とは別のファイルへ分けてある。
 */
export async function selectedChatModels(): Promise<Record<ReplyStyle, ChatModelId>> {
  const store = await cookies();

  return {
    text: normalizeChatModel(store.get(CHAT_MODEL_COOKIE.text)?.value),
    voice: normalizeChatModel(store.get(CHAT_MODEL_COOKIE.voice)?.value),
  };
}
