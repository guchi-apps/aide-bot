/**
 * 1回に送れる発言の長さ（文字数）。
 *
 * 入力欄（クライアント）とAPI（サーバー）の両方が参照する。このモジュールは
 * Prismaにも@anthropic-ai/sdkにも依存させない——クライアント側のバンドルへ
 * SDKごと引きずり込まないため。
 *
 * **#157で、ここにあったタイトルの切り出し（`buildConversationTitle()`）と一覧の見出し
 * （`conversationGroupLabel()`）は消えた。** 相談を話題ごとに分けなくなり、一覧に並ぶのが
 * スレッドではなく日付になったため（`src/lib/day-log.ts`）。
 */
export const MAX_MESSAGE_LENGTH = 8000;
