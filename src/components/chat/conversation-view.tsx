"use client";

import dynamic from "next/dynamic";

import type { ChatEntry } from "./types";

/**
 * 今日の記録は常に「書く」画面（`ChatPanel`）。声で話すときは、入力欄の「話しかける」から開く
 * 音声バー（`voice-bar.tsx`）を使う（#433で秘書の立ち絵の全画面「話す」を廃止した）。
 *
 * **サーバー側の描画（SSR）は既定のまま残している。** `ssr: false` にすると、開いた直後が空白になって出直す。
 * Markdown（`react-markdown` 一式）は初回のHTMLに添えず、後から読み込む。
 */
function PanelPlaceholder() {
  return <div className="flex min-h-0 flex-1" aria-busy="true" />;
}

const ChatPanel = dynamic(() => import("./chat-panel").then((m) => m.ChatPanel), {
  loading: PanelPlaceholder,
});

type Props = {
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。日付の区切りに使う（#157）。 */
  todayKey: string;
  /** 要約へ畳んである発言の数（#157）。 */
  compactedCount: number;
  /** いまの会話の始まり（`9月24日 07:00`。#322）。区切っていなければnull。 */
  contextSince: string | null;
};

/**
 * 今日の記録。書き込む先は利用者につき1本の連続セッション。
 *
 * 表示の元は `initialEntries` で、直前のやり取りは送信のたびの `router.refresh()` で取り直されている。
 *
 * **#157で「新しい相談」が無くなり、`key` の付け替えも要らなくなった。** #155で足していた
 * `useNewConversationEpoch()` は「`/` を開いたまま新しいスレッドを始める」ための仕掛けで、
 * スレッドを分けなくなった今は始める対象そのものが無い。
 */
export function ConversationView({ initialEntries, todayKey, compactedCount, contextSince }: Props) {
  return (
    <ChatPanel
      initialEntries={initialEntries}
      todayKey={todayKey}
      compactedCount={compactedCount}
      contextSince={contextSince}
    />
  );
}
