"use client";

import { VoicePanel } from "@/components/voice/voice-panel";

import { ChatPanel } from "./chat-panel";
import { useTalkMode } from "./talk-mode-context";
import type { ChatEntry } from "./types";

type Props = {
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。日付の区切りに使う（#157）。 */
  todayKey: string;
  /** 要約へ畳んである発言の数（#157）。 */
  compactedCount: number;
};

/**
 * 今日の記録。「話す」と「書く」で見た目も操作も変わるが、書き込む先は同じ連続セッション。
 *
 * どちらも表示の元は同じ `initialEntries` で、直前のやり取りは送信のたびの
 * `router.refresh()` で取り直されている。
 *
 * **#157で「新しい相談」が無くなり、`key` の付け替えも要らなくなった。** #155で足していた
 * `useNewConversationEpoch()` は「`/` を開いたまま新しいスレッドを始める」ための仕掛けで、
 * スレッドを分けなくなった今は始める対象そのものが無い。
 */
export function ConversationView({ initialEntries, todayKey, compactedCount }: Props) {
  const { mode } = useTalkMode();

  return mode === "voice" ? (
    <VoicePanel initialEntries={initialEntries} todayKey={todayKey} />
  ) : (
    <ChatPanel initialEntries={initialEntries} todayKey={todayKey} compactedCount={compactedCount} />
  );
}
