/**
 * 秘書の側が自動で積む「依頼文」の印（#280）。**クライアントコンポーネントからimportする。**
 *
 * 朝の見通し（#79。`MORNING_BRIEFING_REQUEST`）と急ぎのお知らせ（#115。`URGENT_NOTICE_REQUEST`）は、
 * 相談の1通目をUSERとして保存する。履歴の先頭がUSERである必要があるためで、朝の見通しは
 * 実際にモデルへ渡した依頼そのもの。**ただ、利用者が書いた発言ではないので、記録の画面には
 * 出さない**（`EntryList`）。DBには残し、モデルへ渡す履歴にも入れたままにする。
 *
 * 判定は本文の前置きで行う。列を足す案（`Message` に非表示の印）は、マイグレーションが要るうえ、
 * この印を付けるより前に積まれた依頼文が隠れないため採らなかった。**依頼文を新しく足すときは
 * 必ずこの前置きから組み立てる**——外れると画面に依頼文が出る。
 */
export const AUTO_REQUEST_PREFIX = "（自動）";

/** 記録の画面から隠す発言かどうか。利用者の発言（USER）で、前置きから始まるものだけ。 */
export function isAutoRequest(role: "USER" | "ASSISTANT", content: string): boolean {
  return role === "USER" && content.startsWith(AUTO_REQUEST_PREFIX);
}
