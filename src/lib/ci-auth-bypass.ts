import { timingSafeEqual } from "node:crypto";

/**
 * 開発／CI専用のログインバイパス（#25）。
 *
 * aide-botの画面はすべてSupabase Auth（Google OAuth）の背後にあり、OAuthは外部サイトでの
 * 対話的な同意を必ず経由する。GUIの無いサブPC上のエージェントも、GitHub Actionsの無人実行も
 * ログインを完了できないため、認証を突破するのではなく**アプリ側に開発専用の入口を用意して
 * そこから入る**（auth-dev-login skill）。
 *
 * **本番で有効にならないことを二重に塞ぐ。** `NODE_ENV=production` での無効化と、
 * `CI_LOGIN_BYPASS_SECRET` 未設定での無効化の両方が必要で、片方だけ緩めてはいけない。
 */

/** バイパス用のCookie名。`POST /api/dev/login` が立て、middlewareと `getCurrentUser()` が見る。 */
export const CI_BYPASS_COOKIE_NAME = "ci-login-bypass";

/**
 * バイパスで入るダミーユーザーの `supabaseUserId`。
 * `scripts/seed-ci-db.mjs` がこのIDでUser行をupsertする（値が一致していないと画面が
 * 「ユーザー未作成」として `/login` へ戻る）。
 */
export const CI_BYPASS_SUPABASE_USER_ID = "ci-screenshot-bot";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual は長さが違うと例外を投げるため、先に長さを見る。
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * 開発用ログインを有効にしてよい環境か。
 *
 * ログイン画面にボタンを出すか、`/api/dev/login` が404を返すかの判定に使う。
 * DBにも `next/headers` にも触れない純粋関数なので、サーバーコンポーネント・
 * Route Handler・middlewareのどこからでも呼べる。
 */
export function isDevLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.CI_LOGIN_BYPASS_SECRET ?? "").length > 0;
}

/**
 * このリクエストをバイパス済み（ログイン済みとみなす）として扱ってよいか。
 *
 * 有効な環境であることに加えて、Cookieの値がシークレットと一致する場合だけ真を返す。
 * 比較はタイミング攻撃を避けるため `timingSafeEqual` で行う。
 */
export function isCiBypassRequest(cookieValue: string | undefined): boolean {
  if (!isDevLoginEnabled()) return false;
  if (!cookieValue) return false;

  return safeEqual(cookieValue, process.env.CI_LOGIN_BYPASS_SECRET!);
}
