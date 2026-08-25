"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { TALK_MODE_COOKIE, TALK_MODE_MAX_AGE, type TalkMode } from "@/lib/talk-mode";

type TalkModeValue = {
  mode: TalkMode;
  setMode: (mode: TalkMode) => void;
};

const TalkModeContext = createContext<TalkModeValue | null>(null);

/**
 * 「話す / 書く」の状態を、ヘッダーの切り替えと本文の出し分けで共有する。
 *
 * 切り替えはヘッダー（`chat-shell.tsx`）にあり、それを見て中身を差し替えるのは
 * `conversation-view.tsx` で、間に相談一覧のレイアウトが挟まる。propsで引き回すと
 * 経路上の全部を触ることになるためcontextにする。
 */
export function TalkModeProvider({
  initialMode,
  children,
}: {
  initialMode: TalkMode;
  children: React.ReactNode;
}) {
  const [mode, setModeState] = useState<TalkMode>(initialMode);

  const setMode = useCallback((next: TalkMode) => {
    setModeState(next);
    // 次に開いたときも同じモードで始める。サーバー側が最初の描画で読む。
    document.cookie = `${TALK_MODE_COOKIE}=${next}; path=/; max-age=${TALK_MODE_MAX_AGE}; samesite=lax`;
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <TalkModeContext.Provider value={value}>{children}</TalkModeContext.Provider>;
}

export function useTalkMode(): TalkModeValue {
  const value = useContext(TalkModeContext);
  if (!value) {
    throw new Error("useTalkMode は TalkModeProvider の中でだけ使えます");
  }
  return value;
}
