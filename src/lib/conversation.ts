/**
 * 1回に送れる発言の長さ（文字数）。
 *
 * 入力欄（クライアント）とAPI（サーバー）の両方が参照する。このモジュールは
 * Prismaにも@anthropic-ai/sdkにも依存させない——クライアント側のバンドルへ
 * SDKごと引きずり込まないため。
 */
export const MAX_MESSAGE_LENGTH = 8000;

const TITLE_MAX_LENGTH = 24;

/**
 * 最初の発言からスレッドのタイトルを作る。
 *
 * モデルに要約させると1相談につき1往復ぶん余分に課金されるため、機械的に切り出す。
 * 手で付け直す導線は今回は無いので、元の発言が復元できる程度に頭を残すことだけを狙う。
 */
export function buildConversationTitle(message: string): string {
  const firstLine = message.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";

  if (firstLine === "") return "新しい相談";
  // Array.from で分割するのは、絵文字などのサロゲートペアを途中で割らないため。
  const characters = Array.from(firstLine);
  if (characters.length <= TITLE_MAX_LENGTH) return firstLine;

  return `${characters.slice(0, TITLE_MAX_LENGTH).join("")}…`;
}

/**
 * 一覧での見出し。相談は「いつの話か」で探すため、更新時刻をその粒度まで丸める。
 *
 * サーバー側で確定させてクライアントへ渡す。クライアントで日付を跨いで計算すると、
 * サーバーとブラウザのタイムゾーン差でハイドレーションがずれる。
 */
export function conversationGroupLabel(updatedAt: Date, now: Date): string {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (updatedAt >= startOfToday) return "今日";

  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  if (updatedAt >= startOfWeek) return "今週";

  return "それ以前";
}
