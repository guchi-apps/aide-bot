/** 一覧に並べるスレッド1件。本文は持たない（一覧では使わないため）。 */
export type ConversationSummary = {
  id: string;
  title: string;
  /** 「今日」「今週」「それ以前」。サーバー側で確定させて渡す。 */
  group: string;
};

/** 画面に並べる発言1件。 */
export type ChatMessage = {
  kind: "message";
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  /** 利用者に割り込まれて途中で終わった返答（#48）。USERの発言では常にfalse。 */
  interrupted?: boolean;
};

/**
 * 書き込みの道具を使った記録1件（#81）。
 *
 * 発言ではないので `Message` には入らない（#46「保存するのは本文だけ」）。画面では発言と
 * 同じ流れの中へ時刻順に混ぜて出すため、並べる側からは同じ配列に見えるようにしてある。
 */
export type ChatToolCall = {
  kind: "tool";
  id: string;
  /** 接続先の名前（「AIDE」など）。 */
  server: string;
  /** 道具の名前（`aide_zaim_payment` など）。 */
  tool: string;
  /** モデルが渡した引数のJSON。画面では `toolCallFields()` で組み直す。 */
  input: string;
  /** 接続先が返した内容。受け取る前に打ち切られた往復ではnull。 */
  output: string | null;
  /** 接続先が失敗を返した。 */
  failed: boolean;
};

/** 相談の画面に時刻順で並ぶもの。 */
export type ChatEntry = ChatMessage | ChatToolCall;
