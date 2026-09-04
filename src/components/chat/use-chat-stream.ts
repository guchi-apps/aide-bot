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
 *
 * **#157で、スレッドのIDにまつわるものが全部消えた。** 書き込み先は利用者につき1本の
 * 連続セッションで、サーバー側（`primaryConversation()`）が決める。これで#67・#155で
 * 手当てしていた「新しい相談の1通目で `/c/<ID>` へ移る」という経路そのものが無くなり、
 * 送信の途中で画面が作り直されることも、移動を遅らせる仕掛け（`deferNavigation` /
 * `flushNavigation()`）も要らなくなった。
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
};

export type SendResult = {
  /** 受け取れた返答の全文。中断・失敗でも、そこまでのぶんは入る。 */
  answer: string;
  /** 利用者が止めた。 */
  aborted: boolean;
  /** エラーで終わった。 */
  failed: boolean;
};

export function useChatStream() {
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

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

      let answer = "";
      let failed = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, mode: options.mode }),
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

            if (event.name === "delta") {
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

        // 左メニューの日付一覧（その日の件数）を取り直す。**ルートは変わらない**ので、
        // 画面が作り直されて読み上げや聞き取りが巻き添えで畳まれることは無い（#157）。
        router.refresh();
      }

      return { answer, aborted: controller.signal.aborted, failed };
    },
    [router],
  );

  return { send, abort };
}
