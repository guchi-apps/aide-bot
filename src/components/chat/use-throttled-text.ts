"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 描き直しの間隔（ミリ秒）。
 *
 * 生成中の返答をdeltaごとに描画すると、そのたびに画面が組み直しになる。「書く」では
 * Markdownを毎回組み直すので長い返答の後半で目に見えて詰まり、「話す」では立ち絵・吹き出し・
 * 記録欄まで巻き込む。60msなら1秒に16回ほどで、字が流れて見える速さを保てる。
 */
const FLUSH_INTERVAL_MS = 60;

/**
 * 返答の文字を溜めておき、一定の間隔でだけ画面へ反映する（#228）。
 *
 * 「書く」（`ChatPanel`）が持っていた仕組みを、「話す」（`VoicePanel`）と共有できるよう切り出した。
 * 「話す」は間引かず、届くたびに `setReply` していた。
 *
 * - `push(delta)`: 差分を足す（文字の往復）
 * - `set(full)`: そこまでの全文で置き換える（声の往復。`useVoiceConversation()` は全文を渡す）
 * - `flush()`: 待たずにいまの中身を反映する。往復の終わりで、最後の差分が間引きに残らないように使う
 * - `reset()`: 空にして即座に反映する。次の往復の頭で前の返答を消す
 *
 * 返す関数はどれも参照が変わらないので、依存配列に入れてよい。
 */
export function useThrottledText() {
  const [text, setText] = useState("");
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setText(bufferRef.current);
    }, FLUSH_INTERVAL_MS);
  }, []);

  const push = useCallback(
    (delta: string) => {
      bufferRef.current += delta;
      schedule();
    },
    [schedule],
  );

  const set = useCallback(
    (full: string) => {
      bufferRef.current = full;
      schedule();
    },
    [schedule],
  );

  const flush = useCallback(() => {
    cancelTimer();
    setText(bufferRef.current);
  }, [cancelTimer]);

  const reset = useCallback(() => {
    cancelTimer();
    bufferRef.current = "";
    setText("");
  }, [cancelTimer]);

  useEffect(() => cancelTimer, [cancelTimer]);

  return { text, push, set, flush, reset };
}
