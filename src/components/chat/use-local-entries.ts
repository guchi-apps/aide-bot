"use client";

import { useCallback, useState } from "react";

import { jstTimeLabel } from "@/lib/day-key";

import type { ChatEntry, ChatToolCall } from "./types";

/**
 * 画面の中だけで足す記録の並び（#228）。
 *
 * 送ったばかりの発言と返答は、サーバーが保存したものを取り直す（`router.refresh()`）まで
 * 画面の中でだけ並べる。「書く」（`ChatPanel`）と「話す」（`VoicePanel`）が同じ形で
 * 別々に組み立てていたので、idの決め方・時刻の付け方・割り込みの印をここへ寄せた。
 *
 * - **idは `local-user-<件数>` / `local-assistant-<件数>`。** サーバーの行のidとは重ならない
 * - **返答には日本時間の時刻を添える**（#280）。サーバーが保存する時刻に近い値で、再読み込みした
 *   後の表示とずれない。自分の発言には付けない
 * - **`interrupted` は途中で切れた返答の印**（#48）。本文へ注記を混ぜない
 *
 * 返す関数はどれも参照が変わらない。**日付（`day`）は付けない**——送ったばかりの発言は
 * 必ず今日のもので、`EntryList` などが今日として扱う。
 */
export function useLocalEntries(initialEntries: ChatEntry[]) {
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);

  /** 利用者の発言（書いたもの・聞き取ったもの）を末尾へ足す。 */
  const addUser = useCallback((content: string) => {
    setEntries((previous) => [
      ...previous,
      { kind: "message", id: `local-user-${previous.length}`, role: "USER", content },
    ]);
  }, []);

  /** 秘書の返答を末尾へ足す。1文字も返らなかった往復では呼ばない。 */
  const addAssistant = useCallback((message: { content: string; interrupted: boolean }) => {
    // 時刻は更新関数の外で作る。中で作ると、StrictModeの二重実行で2回目とずれる。
    const time = jstTimeLabel(new Date());
    setEntries((previous) => [
      ...previous,
      {
        kind: "message",
        id: `local-assistant-${previous.length}`,
        role: "ASSISTANT",
        content: message.content,
        interrupted: message.interrupted,
        time,
      },
    ]);
  }, []);

  /** 書き込みの道具を使った記録（#81）を末尾へ足す。 */
  const addRecord = useCallback((call: ChatToolCall) => {
    setEntries((previous) => [...previous, call]);
  }, []);

  return { entries, setEntries, addUser, addAssistant, addRecord };
}
