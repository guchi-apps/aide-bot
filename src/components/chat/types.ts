/**
 * 左メニューに並べる1日ぶん（#157）。
 *
 * 相談はテーマごとに分けなくなったので、一覧に並ぶのはスレッドではなく日付になった。
 * 見出しも月も日本時間で確定させてから渡す——クライアントで日付を組み立てると、
 * サーバーとブラウザのタイムゾーン差でハイドレーションがずれる。
 */
export type DayRow = {
  /** `2026-09-03`。`/d/<date>` のURLに入る。 */
  date: string;
  /** `今日 9月3日（木）`。 */
  heading: string;
  /** `2026年9月`。同じ月が続く間は出さない。 */
  month: string;
  /** その日の発言数。 */
  count: number;
};

/** 画面に並べる発言1件。 */
export type ChatMessage = {
  kind: "message";
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  /** 利用者に割り込まれて途中で終わった返答（#48）。USERの発言では常にfalse。 */
  interrupted?: boolean;
  /** その発言の日付（`2026-09-03`。日本時間。#157）。画面の日付区切りに使う。 */
  day?: string;
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
  /** 呼んだ日付（`2026-09-03`。日本時間。#157）。 */
  day?: string;
};

/** 記録の画面に時刻順で並ぶもの。 */
export type ChatEntry = ChatMessage | ChatToolCall;
