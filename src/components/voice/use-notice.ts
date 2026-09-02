"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 吹き出しに出すものを取り続け、待っている間は一定の間隔で入れ替える（#93・#101）。
 *
 * サーバー側（`resolveNotice()`）が「10分に1回まで」「未読が0件なら叩かない」を守るので、
 * ここは短い間隔で問い合わせてよい。**問い合わせの多くはDBを引くだけで戻る。**
 * 短い間隔にしてあるのは、急ぎが積まれた回にその場で選び直しが走るようにするため。
 *
 * 同じ応答に、待機中に回す「ひとりごと」（`resolveChatter()`）も乗ってくる。**取得口を
 * 分けないのは、問い合わせ1回ごとにmiddlewareの `auth.getUser()` がもう1往復増えるため。**
 */

export type NoticeBubble = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選ばれた時刻（ISO）。吹き出しの末尾に「いつ時点か」を出す。 */
  shownAt: string;
  /**
   * 押したときに開く先（#137）。積む側が付けた元データへのリンクで、無ければnull。
   * サーバー側（`resolveNotice()`）が `safeNoticeUrl()` を通した値だけを載せる。
   */
  url: string | null;
};

/**
 * 待っている間に吹き出しへ出す1枠。お知らせ・ひとりごと・呼びかけが同じ輪に並ぶ。
 *
 * `call` は既定の「どうぞ、話しかけてください」。**輪の中に必ず1つ入れる**——初めて開いた人に
 * 「マイクを押せば始まる」ことを伝える枠で、ひとりごとが1件も取れなかった回にはこれだけが残る。
 */
export type BubbleLine =
  | { kind: "notice"; notice: NoticeBubble }
  | { kind: "chatter"; text: string }
  | { kind: "call" };

/**
 * 問い合わせの間隔。生成の間隔（10分）ではなく、急ぎに気付くまでの上限。
 *
 * **モデルを叩かない問い合わせでも、ただではない。** `/api/*` はRoute Handlerが自分で認証
 * するが、middlewareは素通しの判定より前に必ず `auth.getUser()` を通す
 * （`src/lib/supabase/middleware.ts`）ため、**1回ごとにSupabaseへ1往復増える。**
 * Supabaseは他アプリと共有のプロジェクトで、レート制限もそちらに効く。
 *
 * 1分だと開いている間ずっと60回/時・タブごとになるので、急ぎが出るまでの遅れを3分まで
 * 許して往復を1/3に落としてある。急ぎ側の床（`NOTICE_URGENT_INTERVAL_MS`）は1分のままなので、
 * 実際に待つのは「次の問い合わせまで」だけ。
 */
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * ひとりごとを次の1件へ送るまでの時間（#101）。
 *
 * **入れ替わりは問い合わせと関係なく画面の中だけで進む。** 手元にある数件を順に回すだけなので、
 * ここを短くしても通信もモデルの呼び出しも増えない。短すぎると視界の端でちらつき、長すぎると
 * 「止まっている」ように見えるので、読み終えて少し置ける長さにしてある。
 */
const CHATTER_ROTATE_MS = 25 * 1000;

/**
 * お知らせを出しておく時間。ひとりごとより長く置く。
 *
 * お知らせは「一度だけ選ばれた、いま伝えたいこと」なので、ひとりごとと同じ速さで流すと
 * 読み終える前に消える。**急ぎ（`urgent`）のときは回転そのものを止める**（下記）。
 */
const NOTICE_HOLD_MS = 60 * 1000;

/**
 * 触られないまま問い合わせ続ける上限。
 *
 * **開きっぱなしのタブを1日中叩かせないための錠。** 見えている間だけ動かすだけでは、
 * サブディスプレイに置きっぱなしの画面が丸一日ぶんの生成を回してしまう。
 * 画面を触る・キーを押す・タブへ戻る、のいずれかで数え直す。
 */
const IDLE_LIMIT_MS = 60 * 60 * 1000;

type Payload = { notice: NoticeBubble | null; chatter: string[] };

/**
 * 前回と同じ中身か。
 *
 * 3分ごとの問い合わせは**ほとんどの回で同じものを返す。** そのたびに新しいオブジェクトを
 * 入れると輪が作り直され、いま出している一言の残り時間が毎回25秒に戻る（＝入れ替わりが
 * 止まって見える回ができる）。
 */
function samePayload(a: Payload, b: Payload): boolean {
  return (
    a.notice?.id === b.notice?.id &&
    a.notice?.text === b.notice?.text &&
    a.notice?.shownAt === b.notice?.shownAt &&
    a.notice?.url === b.notice?.url &&
    a.chatter.length === b.chatter.length &&
    a.chatter.every((line, index) => line === b.chatter[index])
  );
}

export function useBubbleLine(): BubbleLine | null {
  const [payload, setPayload] = useState<Payload>({ notice: null, chatter: [] });
  const [step, setStep] = useState(0);
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
            const data = (await response.json()) as Partial<Payload>;
            if (!cancelled) {
              const next: Payload = { notice: data.notice ?? null, chatter: data.chatter ?? [] };
              setPayload((prev) => (samePayload(prev, next) ? prev : next));
            }
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

  /**
   * 回す輪。お知らせは先頭に置き、ひとりごとと同じ輪の中で繰り返し出す。
   *
   * 出したきりにしないのは、お知らせが選ばれた回だけ吹き出しが1時間固まって、
   * 「常に何か話している」が止まってしまうため（#93の表示の上限はサーバー側に残る）。
   */
  const ring = useMemo<BubbleLine[]>(() => {
    const lines: BubbleLine[] = payload.chatter.map((text) => ({ kind: "chatter", text }));
    // 呼びかけは2枠目に置く。先頭にすると、開いた瞬間はいつも同じ文言になる。
    lines.splice(Math.min(1, lines.length), 0, { kind: "call" });
    if (payload.notice) lines.unshift({ kind: "notice", notice: payload.notice });
    return lines;
  }, [payload]);

  const current = ring.length === 0 ? null : ring[step % ring.length];

  useEffect(() => {
    if (!current || ring.length <= 1) return;
    // 急ぎのお知らせは流さない。読み終える前に次のひとりごとへ移ると、
    // いちばん伝えたいものだけが見逃される。
    if (current.kind === "notice" && current.notice.urgent) return;

    const delay = current.kind === "notice" ? NOTICE_HOLD_MS : CHATTER_ROTATE_MS;
    const timer = setTimeout(() => setStep((value) => value + 1), delay);

    return () => clearTimeout(timer);
  }, [current, ring.length]);

  return current;
}
