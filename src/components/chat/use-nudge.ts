"use client";

import { useEffect, useRef } from "react";

/**
 * 秘書から話しかけてきた発言を取り続ける（声かけ。#278）。「書く」画面から使う。
 *
 * 取得口は増やさず、「話す」画面の吹き出しが使っている `/api/notices/current` へ `?since=`
 * を付けて相乗りさせている。**`/api/*` は素通しの判定より前に必ず `auth.getUser()` を通る**
 * （`src/lib/supabase/middleware.ts`）ため、口を1つ増やすと問い合わせ1回ごとにSupabaseへの
 * 往復が1つ増える（#93・#101と同じ理由）。
 *
 * 積むのも選ぶのもサーバー側で、ここは**受け取って渡すだけ**。歯止め（30分に1回まで・
 * 会話の最中は積まない・同じ材料は一度だけ）はすべて `src/lib/nudge.ts` にある。
 *
 * 型を `@/lib/nudge` から持ってこないのは、あちらがPrismaを引き込むサーバー専用モジュールの
 * ため。`import type` なら消えるが、消えることに依存した書き方をこの境目に増やさない。
 */

/** 声かけ1件（サーバーの `Nudge` と同じ形）。 */
export type NudgeMessage = { id: string; content: string; createdAt: string };

/**
 * 問い合わせの間隔。吹き出し（`use-notice.ts`）と同じ3分。
 *
 * 同じ口を叩くので、片方だけ短くしても意味がない（サーバー側の歯止めは時刻で効く）。
 */
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/** 触られないまま問い合わせ続ける上限。開きっぱなしのタブを1日中叩かせないための錠。 */
const IDLE_LIMIT_MS = 60 * 60 * 1000;

/**
 * 声かけが届いたら `onNudge` を呼ぶ。
 *
 * `paused` が真のあいだは問い合わせそのものを見送る。**返答の生成中に足さないため**——
 * 画面の中だけで足した発言（利用者の発言・生成中の返答）と混ざる順序を考えずに済ませる。
 * サーバー側も生成中は積まない（`NUDGE_QUIET_MS`）ので、見送ったぶんは次の回で届く。
 */
export function useNudges(onNudge: (nudges: NudgeMessage[]) => void, paused: boolean): void {
  const onNudgeRef = useRef(onNudge);
  const pausedRef = useRef(paused);
  /** 「これより後の声かけ」の基準。開いた時点から始める（それ以前の記録は描画に含まれている）。 */
  const sinceRef = useRef("");
  // 描画のたびに読むと値が揺れる（`react-hooks/purity`）。効果の中で入れる。
  const lastActivityRef = useRef(0);

  useEffect(() => {
    onNudgeRef.current = onNudge;
  }, [onNudge]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    lastActivityRef.current = Date.now();
    // 開き直し（React Strict Modeの二重実行を含む）では基準を戻さない。戻すと、すでに
    // 画面へ足した声かけをもう一度受け取ってしまう。
    if (sinceRef.current === "") sinceRef.current = new Date().toISOString();

    const schedule = (delay: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;

      const visible = document.visibilityState === "visible";
      const idle = Date.now() - lastActivityRef.current > IDLE_LIMIT_MS;

      if (visible && !idle && !pausedRef.current) {
        try {
          const response = await fetch(
            `/api/notices/current?since=${encodeURIComponent(sinceRef.current)}`,
            { cache: "no-store" },
          );

          if (response.ok) {
            const data = (await response.json()) as { nudges?: NudgeMessage[] };
            const nudges = (data.nudges ?? []).filter(
              (nudge) =>
                typeof nudge?.id === "string" &&
                typeof nudge.content === "string" &&
                typeof nudge.createdAt === "string",
            );

            if (!cancelled && nudges.length > 0) {
              sinceRef.current = nudges[nudges.length - 1].createdAt;
              onNudgeRef.current(nudges);
            }
          }
        } catch {
          // 取れなかった回は黙って見送る。声かけは「届かなくても困らない」もので、
          // ここで通信の失敗を画面へ出すと、相談の流れに小言が混ざる（#93と同じ理由）。
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
}
