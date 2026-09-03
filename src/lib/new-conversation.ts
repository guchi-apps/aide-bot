"use client";

import { useSyncExternalStore } from "react";

/**
 * 「新しい相談」を押したことを、画面の中身（`ConversationView`）へ伝えるだけの入れ物（#155）。
 *
 * **左メニューの「新しい相談」は `/` へのリンクで、`/` を開いている間は何も起きない。**
 * ルートが変わらないのでReactは相談の画面を作り直さず、`useChatStream` が覚えている
 * スレッドのID（`startedIdRef`）も、画面が持っている発言も、そのまま残る——押した後に
 * 話しかけた内容が**さっきまでの相談へ足される。**
 *
 * 「話す」は `/c/<ID>` へ移らない（#155。移ると往復が巻き添えで消えるため）ので、
 * この状態が相談を続けている間ずっと続く。押されたことを数えて、その値を相談の画面の
 * `key` に混ぜることで、同じルートのままでも作り直せるようにする。
 *
 * 声の設定（`@/lib/speech/voice-settings`）と同じく、Reactの外に置いた極小のストアにする。
 * 左メニューは相談の一覧のレイアウト側、相談の画面はページ側にあり、間に何段も挟まるため
 * propsでは引き回せない。
 */

let epoch = 0;
const listeners = new Set<() => void>();

/** 「新しい相談」が押された。相談の画面を作り直させる。 */
export function requestNewConversation(): void {
  epoch += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): number {
  return epoch;
}

/** サーバー側の描画では常に0。ハイドレーションで食い違わせない。 */
function getServerSnapshot(): number {
  return 0;
}

export function useNewConversationEpoch(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
