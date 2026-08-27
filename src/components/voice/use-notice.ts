"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 吹き出しに出すお知らせを取り続ける（#93）。
 *
 * サーバー側（`resolveNotice()`）が「10分に1回まで」「未読が0件なら叩かない」を守るので、
 * ここは短い間隔で問い合わせてよい。**問い合わせの多くはDBを引くだけで戻る。**
 * 短い間隔にしてあるのは、急ぎが積まれた回にその場で選び直しが走るようにするため。
 */

export type NoticeBubble = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選ばれた時刻（ISO）。吹き出しの末尾に「いつ時点か」を出す。 */
  shownAt: string;
};

/** 問い合わせの間隔。生成の間隔（10分）ではなく、急ぎに気付くまでの上限。 */
const POLL_INTERVAL_MS = 60 * 1000;

/**
 * 触られないまま問い合わせ続ける上限。
 *
 * **開きっぱなしのタブを1日中叩かせないための錠。** 見えている間だけ動かすだけでは、
 * サブディスプレイに置きっぱなしの画面が丸一日ぶんの生成を回してしまう。
 * 画面を触る・キーを押す・タブへ戻る、のいずれかで数え直す。
 */
const IDLE_LIMIT_MS = 60 * 60 * 1000;

export function useNotice(): NoticeBubble | null {
  const [notice, setNotice] = useState<NoticeBubble | null>(null);
  // 描画のたびに読むと値が揺れる（`react-hooks/purity`）。最後に触られた時刻は
  // 効果の中で入れ、それまでは0＝「まだ触られていない」として扱う。
  const lastActivityRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // 画面が現れた時点を最初の「触られた」とみなす。0のままだと、開いた直後に
    // 休止の条件（最後に触ってから1時間）を満たしてしまい、一度も問い合わせない。
    lastActivityRef.current = Date.now();

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;

      const visible = document.visibilityState === "visible";
      const idle = Date.now() - lastActivityRef.current > IDLE_LIMIT_MS;

      if (visible && !idle) {
        try {
          const response = await fetch("/api/notices/current", { cache: "no-store" });
          if (response.ok) {
            const data = (await response.json()) as { notice: NoticeBubble | null };
            if (!cancelled) setNotice(data.notice);
          }
        } catch {
          // 取れなかった回は黙って見送る。吹き出しは状況を知らせる場所で、
          // ここへ通信の失敗を出しても利用者にできることが無い。
        }
      }

      schedule(POLL_INTERVAL_MS);
    };

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };

    /** タブへ戻った直後は、次の周期を待たずに取り直す（休んでいた間の分が出ていない）。 */
    const onVisibility = () => {
      markActive();
      if (document.visibilityState === "visible") schedule(0);
    };

    window.addEventListener("pointerdown", markActive);
    window.addEventListener("keydown", markActive);
    document.addEventListener("visibilitychange", onVisibility);

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return notice;
}
