/**
 * このアプリのセッションだけを破棄する（#292）。
 *
 * Supabaseは他アプリと共有のプロジェクトで、`signOut()` を引数なしで呼ぶと既定の
 * `scope: "global"` になり、同じユーザーの**他アプリ・他端末のrefresh tokenまで失効する**。
 * このアプリからログアウトしただけで、共有Supabaseを使う別のアプリのログインが切れてしまう。
 * `scope: "local"` はいまのセッションだけを終わらせる。
 *
 * **`supabase.auth.signOut()` を直接呼ばず、必ずここを通す**（通常のログアウト・許可外の
 * アカウントの破棄）。`test/sign-out.test.ts` が、`src/` に引数なしや `global` の呼び出しが
 * 残っていないことも確かめる。このアプリにアカウント自体を削除する操作は無い。作るなら、
 * 全セッションを終わらせる意図をその場で明示すること。
 *
 * Supabaseクライアントの型は引かず、使う口だけを構造で受ける（テストが素のNodeで動くように、
 * このモジュールはどこにもimportしない）。
 */
export type SignOutClient = {
  auth: {
    signOut(options: { scope: "local" }): Promise<{ error: { message: string } | null }>;
  };
};

export function signOutThisApp(supabase: SignOutClient) {
  return supabase.auth.signOut({ scope: "local" });
}
