import { createHash, randomBytes } from "node:crypto";

/**
 * 起床の合図（#233）を受け付けるためのトークン。**サーバー専用。**
 *
 * iPhoneのショートカットへ入れる値で、利用者ごとに1本。DBにはSHA-256のハッシュだけを持つ。
 * 表示できるのは発行した直後の1回だけで、控えを失ったら作り直す。dayspanのように暗号化して
 * 再表示できるようにすると、暗号鍵のシークレットが1つ増え、1Passwordと本番設定の手作業が要る。
 *
 * **環境変数の `BRIEFING_TRIGGER_TOKEN` を使い回さない。** あちらはVPS内のcronが叩くための値で、
 * iPhoneへ持ち出すと漏れたときに全利用者ぶんの起動ができてしまう。こちらは利用者を特定する鍵を兼ねる。
 */

export function generateWakeToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashWakeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** `Authorization: Bearer <token>` から値を取り出す。無ければnull。 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;

  const token = header.slice("Bearer ".length).trim();
  return token === "" ? null : token;
}
