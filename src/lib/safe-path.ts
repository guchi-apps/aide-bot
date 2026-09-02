/**
 * リダイレクト先として受け取った「このアプリの中のパス」を検証する。
 *
 * 受け取る値はいずれも外から与えられる（`/login?callbackUrl=`・`/auth/signin?next=`・
 * `/auth/callback?next=`）。最後は `new URL(値, オリジン)` やリンクの `href` へ渡るため、
 * **URLとして解釈したときに別のオリジンへ出てしまう形**をここで落とす。
 */

/**
 * `//example.com` はプロトコル相対URLとして外部サイトへ出る。**`/\example.com` も同じ**
 * ——URLの解釈ではバックスラッシュがスラッシュとして読まれる（#140で実測）。
 */
const PROTOCOL_RELATIVE = /^\/[/\\]/;

/**
 * URLとして解釈されるときに**取り除かれる**文字（タブ・改行・復帰）と、前後から**削られる**
 * 制御文字・空白が混ざっていないか。
 *
 * 残したまま通すと、`/\n/example.com` が `//example.com` として解釈され、上の判定を
 * 素通りしたまま外部サイトへのリダイレクトになる（#140で実測。`%09` / `%0A` / `%0D` の
 * いずれでも同じ）。パスとして正当な値なら、これらは必ずパーセントエンコードされている。
 */
function hasCharStrippedByUrlParser(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** このアプリの中のパスとして安全に扱えるか。`safeNoticeUrl()`（#137）もこれを通す。 */
export function isInternalPath(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (hasCharStrippedByUrlParser(value)) return false;
  return !PROTOCOL_RELATIVE.test(value);
}

export function safeInternalPath(value: string | null, fallback: string): string {
  if (!value) return fallback;
  return isInternalPath(value) ? value : fallback;
}
