"use client";

import dynamic from "next/dynamic";

import { useTalkMode } from "./talk-mode-context";
import type { ChatEntry } from "./types";

/**
 * **使わない側のパネルは読み込まない**（#228）。「話す」はロボット（SVG・3Dの読み込み口）・吹き出し・
 * 声の設定・今日の記録、「書く」はMarkdown（`react-markdown` 一式）を引き連れているが、開いている
 * モードで使うのはどちらか一方だけ。静的にimportすると、使わない側のぶんも毎回読み込む。
 *
 * **サーバー側の描画（SSR）は既定のまま残している。** 最初のHTMLは今のモードで描かれ、そのモードの
 * チャンクだけがページに添えられる。`ssr: false` にすると、開いた直後が空白になって出直す。
 * 切り替えたときだけ、もう一方のチャンクを取りに行く（読み込む間は枠だけを出す）。
 *
 * **音声の往復（`useVoiceConversation()`）は「書く」の音声バーも使うので、どちらのモードでも
 * 読み込まれる。** ここで外れるのは、ロボット・吹き出し・声の全画面の見た目・Markdownだけ。
 */
function PanelPlaceholder() {
  return <div className="flex min-h-0 flex-1" aria-busy="true" />;
}

const VoicePanel = dynamic(() => import("@/components/voice/voice-panel").then((m) => m.VoicePanel), {
  loading: PanelPlaceholder,
});

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
