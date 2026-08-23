/**
 * 初期リリースは所有者本人のみ利用可能とする。
 * 許可メールアドレスは環境変数 ALLOWED_GOOGLE_EMAILS にカンマ区切りで設定する。
 *
 * 将来の公開範囲の変更時にこの関数だけを直せば済むよう、判定を1箇所に閉じている。
 * 未設定のまま誰でも入れる状態になるのを避けるため、未設定時は全員拒否とする。
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowed = (process.env.ALLOWED_GOOGLE_EMAILS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (allowed.length === 0) return false;

  return allowed.includes(email.toLowerCase());
}
