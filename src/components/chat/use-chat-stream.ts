"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

import type { ChatToolCall } from "@/components/chat/types";
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
  /** 繋いだ外部サービスの道具を使い始めたとき（#46）。返答が始まるまでの間を埋めるために使う。 */
  onTool?: (activity: { server: string; tool: string }) => void;
  /**
   * 書き込みの道具の呼び出しが済んだとき（#81）。
   *
   * `onTool` が「いま調べています」という一瞬の表示なのに対し、こちらは**そのまま記録として
   * 残るもの**。サーバー側でも同じ内容を `ToolCall` へ保存しているので、呼ぶ側は
   * 再読み込みしたときと同じ並び——秘書の返答より前——へ足せばよい。
   */
  onRecord?: (call: ChatToolCall) => void;
  /** 利用者へ出す文言。中断のときは呼ばれない。 */
  onError: (message: string) => void;
  /**
   * 新しい相談で `/c/<ID>` へ移るのを、呼ぶ側が `flushNavigation()` を呼ぶまで遅らせる（#67）。
   *
   * この移動はルートをまたぐため、画面（`VoicePanel` など）が作り直される。「話す」では
   * 送信を終えた後も読み上げと聞き取りが続いているので、途中で作り直されると読み上げが
   * 途切れ、開いたばかりのマイクごと畳まれて「待っています」へ戻ってしまう。
   *
   * **「話す」はこれを最後まで消化しない（#155）。** 消化するのは「文字で送る」で
   * 「書く」へ切り替えるときだけで、それまでURLは `/` のまま。待機に入った時点で移す形
   * （#67）だと、移動を頼んでから切り替わるまでの間にマイクを押した往復が丸ごと消える。
   */
  deferNavigation?: boolean;
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

  // `deferNavigation` で遅らせている移動先。`flushNavigation()` で消化する。
  const pendingConversationIdRef = useRef<string | null>(null);

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

  /**
   * 遅らせておいた `/c/<ID>` への移動を行う（#67）。
   *
   * 呼ぶ側が「いま画面を作り直されても失うものが無い」と判断した時点で呼ぶ。遅らせて
   * いない送信では何もしない。
   *
   * **「待機に入った」はその時点にならない（#155）。** 待機のすぐ後は利用者が次に
   * 話しかける時点そのもので、移動が切り替わるまでの1〜2秒にマイクを押されると、
   * 聞き取りも送信中の問い合わせも作り直しに巻き込まれる。「話す」から呼ぶのは、
   * 利用者が「書く」へ切り替えたときだけにしてある。
   */
  const flushNavigation = useCallback(() => {
    const pendingId = pendingConversationIdRef.current;
    if (!pendingId) return;

    pendingConversationIdRef.current = null;
    router.replace(`/c/${pendingId}`);
  }, [router]);

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
            } else if (event.name === "tool") {
              options.onTool?.({
                server: readString(event.data, "server") ?? "外部サービス",
                tool: readString(event.data, "tool") ?? "",
              });
            } else if (event.name === "record") {
              options.onRecord?.({
                kind: "tool",
                id: readString(event.data, "id") ?? `tool-${Date.now()}`,
                server: readString(event.data, "server") ?? "外部サービス",
                tool: readString(event.data, "tool") ?? "",
                input: readString(event.data, "input") ?? "",
                output: readString(event.data, "output"),
                failed: event.data.failed === true,
              });
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
          // ただしルートをまたぐ移動なので画面は作り直される。まだ続きがある画面では
          // `flushNavigation()` まで待たせる（#67）。
          if (options.deferNavigation) pendingConversationIdRef.current = createdConversationId;
          else router.replace(`/c/${createdConversationId}`);
        }
        // 一覧の並び順とタイトルを取り直す。
        router.refresh();
      }

      return { answer, aborted: controller.signal.aborted, failed };
    },
    [conversationId, router],
  );

  return { send, abort, flushNavigation };
}
