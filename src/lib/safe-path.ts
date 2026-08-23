/**
 * リダイレクト先として受け取ったパスを検証する。
 *
 * `//example.com` のような値は、ブラウザからはプロトコル相対URLとして外部サイトへの
 * リダイレクトになるため、先頭が `/` であることに加えて `//` で始まらないことも確かめる。
 */
export function safeInternalPath(value: string | null, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
