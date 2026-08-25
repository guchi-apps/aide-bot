"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import { parseStreamEvent, readString } from "@/lib/sse";

/**
 * 相談を送って返答を受け取るところ。「話す」と「書く」で共有する。
 *
 * `POST /api/chat` への送信、Server-Sent Eventsの読み取り、中断、新しいスレッドが
 * 作られたときの遷移、一覧の取り直しまでをここに閉じる。画面ごとに違うのは受け取った
 * 文字をどう見せるか（Markdownとして描くか、読み上げへ流すか）だけなので、そこは
 * コールバックで呼ぶ側へ渡す。
 *
 * 片側だけ直して取り残されるのを防ぐため、送信の経路はこの1か所に置く（#27）。
 *
 * 返答の途中で次を送る「割り込み」（#48）は呼ぶ側が組み立てる。順序（そこまでの返答を
 * 残してから次の発言を並べる）が画面ごとに違うため、ここでは `abort()` を提供するに留める。
 */

export type SendOptions = {
  /** 音声で聞く場合に `voice`。返答の体裁と長さが変わる。 */
  mode?: "voice";
  /** 返答が届くたび。届いた差分だけを渡す。 */
  onDelta: (text: string) => void;
  /** 利用者へ出す文言。中断のときは呼ばれない。 */
  onError: (message: string) => void;
};

export type SendResult = {
  /** 受け取れた返答の全文。中断・失敗でも、そこまでのぶんは入る。 */
  answer: string;
  /** 利用者が止めた。 */
  aborted: boolean;
  /** エラーで終わった。 */
  failed: boolean;
};

export function useChatStream(conversationId: string | null) {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  // 新しい相談で最初の返答を割り込むと、`router.replace()` が効く前に2通目が飛ぶ。
  // propsの `conversationId` はまだnullなので、そのまま送るとスレッドがもう1本作られる。
  // 一度受け取ったIDを覚えておき、propsが追いつくまではこちらを使う（#48）。
  const startedIdRef = useRef<string | null>(null);

  useEffect(() => {
    startedIdRef.current = null;
  }, [conversationId]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  /** 生成中の返答を打ち切る。送信中でなければ何もしない。 */
  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (message: string, options: SendOptions): Promise<SendResult> => {
      const controller = new AbortController();
      abortRef.current = controller;

      const targetId = conversationId ?? startedIdRef.current;

      let answer = "";
      let createdConversationId: string | null = null;
      let failed = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: targetId, message, mode: options.mode }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(
            detail?.error ?? "送信できませんでした。通信状況を確認して、もう一度お試しください。",
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSEのイベント区切りは空行。最後の断片は次のチャンクと繋げる。
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const event = parseStreamEvent(block);
            if (!event) continue;

            if (event.name === "meta") {
              createdConversationId = readString(event.data, "conversationId");
              startedIdRef.current = createdConversationId;
            } else if (event.name === "delta") {
              const delta = readString(event.data, "text") ?? "";
              answer += delta;
              options.onDelta(delta);
            } else if (event.name === "error") {
              failed = true;
              options.onError(readString(event.data, "message") ?? "返答の生成に失敗しました。");
            }
          }
        }
      } catch (caught) {
        // 「止める」を押した場合もここに来る。利用者が止めたものはエラーとして出さない。
        if (!controller.signal.aborted) {
          failed = true;
          options.onError(caught instanceof Error ? caught.message : "送信できませんでした。");
        }
      } finally {
        // 自分のcontrollerのときだけ外す。割り込みで往復が重なった場合に無条件で外すと、
        // 後から始まった往復の「止める」が効かなくなる（#48）。
        if (abortRef.current === controller) abortRef.current = null;

        if (conversationId === null && createdConversationId !== null) {
          // 新しく作られたスレッドのURLへ移す。同じ内容がDBにあるので表示は変わらない。
          router.replace(`/c/${createdConversationId}`);
        }
        // 一覧の並び順とタイトルを取り直す。
        router.refresh();
      }

      return { answer, aborted: controller.signal.aborted, failed };
    },
    [conversationId, router],
  );

  return { send, abort };
}
