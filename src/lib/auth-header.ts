/**
 * proxy.ts が検証したSupabaseユーザーIDを、後段のページ・ルートハンドラへ渡すためのヘッダー。
 *
 * proxy.ts はmatcherに一致するすべてのリクエストでこの値を必ず上書きし、未ログインなら削除する。
 * そのため、クライアントが同名のヘッダーを詐称して送ってきても後段には届かない。
 */
export const SUPABASE_USER_ID_HEADER = "x-aide-bot-supabase-user-id";
