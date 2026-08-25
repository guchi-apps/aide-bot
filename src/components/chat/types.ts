/** 一覧に並べるスレッド1件。本文は持たない（一覧では使わないため）。 */
export type ConversationSummary = {
  id: string;
  title: string;
  /** 「今日」「今週」「それ以前」。サーバー側で確定させて渡す。 */
  group: string;
};

/** 画面に並べる発言1件。 */
export type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  /** 利用者に割り込まれて途中で終わった返答（#48）。USERの発言では常にfalse。 */
  interrupted?: boolean;
};
