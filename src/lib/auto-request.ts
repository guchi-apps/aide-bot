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

/** 自動配信の返答を見分けるのに要る、発言の最小限の形。 */
type MessageLike = { role: "USER" | "ASSISTANT"; content: string; proactive: boolean };

/**
 * 秘書が自動で配信した返答に「秘書の側から話しかけた」印（`proactive`）を立てる（#422）。
 *
 * 朝の見通し・朝の話題・急ぎのお知らせ・先回りの提案は `appendSecretaryExchange()` で
 * 「依頼文（USER）＋返答（ASSISTANT）」の2通として積まれ、返答には印が付いていない。
 * 画面の「秘書から」の名札は印で出し分けるので、**依頼文の直後の返答**を自動配信と見なす。
 * DBの `proactive` は声かけ（#278）の意味のまま変えない——`nudgesSince()` がその列で引くため。
 *
 * `before` は取り出した範囲の**直前の1件**。引き継ぎや日付の境目で依頼文だけが範囲外に落ちると、
 * 先頭の返答が見分けられなくなる。並びは古い順で渡すこと。
 */
export function markAutoReplies<T extends MessageLike>(messages: T[], before?: MessageLike | null): T[] {
  return messages.map((message, index) => {
    if (message.role !== "ASSISTANT" || message.proactive) return message;
    const previous = index === 0 ? before : messages[index - 1];
    if (!previous || !isAutoRequest(previous.role, previous.content)) return message;
    return { ...message, proactive: true };
  });
}
