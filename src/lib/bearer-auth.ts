import { createHash, timingSafeEqual } from "node:crypto";

/**
 * `Authorization: Bearer <共有シークレット>` を検証する（#297）。
 *
 * **`expected` が未設定（undefined・空文字）なら常に偽。** 「未設定なら誰でも通れる」にすると、
 * 設定漏れがそのまま公開エンドポイントになる（`BRIEFING_TRIGGER_TOKEN` の経路と同じ考え方）。
 * 未設定なのか値が違うのかは呼び出し側にも返さない。
 *
 * ダイジェスト同士を突き合わせるので、長さの違いで早く抜けることもない。
 */
export function hasValidBearer(header: string | null, expected: string | undefined): boolean {
  if (!expected) return false;

  const prefix = "Bearer ";
  if (!header || !header.startsWith(prefix)) return false;

  const provided = header.slice(prefix.length);
  if (provided === "") return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
