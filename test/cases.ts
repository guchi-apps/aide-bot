/**
 * 外から来る値の判定テストが共有する入力（#248）。
 *
 * `src/lib/safe-path.ts`・`src/lib/notice-url.ts` と、同じ判定を二重に持っている
 * `public/sw.js` の `safeTarget()` の**3つに同じ入力を流す**ために、表をここへ1つだけ置く。
 * 片方にだけ足すと、足していない側が同じ穴を持ったまま残る（#137 → #140）。
 */

/** [入力, 期待する戻り値（落とすなら null）, 理由]。`public/sw.js` の照合（sw-parity.test.ts）も同じ表を使う。 */
export const NOTICE_URL_CASES: [unknown, string | null, string][] = [
  ["/", "/", "ルート"],
  ["/notices", "/notices", "アプリ内のパス"],
  ["  /notices  ", "/notices", "前後の空白は取り除く"],
  ["https://asset-manager.gucchii.com/payments/1", "https://asset-manager.gucchii.com/payments/1", "https"],
  ["http://localhost:3000/a", "http://localhost:3000/a", "http"],
  ["https://example.com", "https://example.com", "元の文字列を返す（末尾のスラッシュを足さない）"],
  ["HTTPS://EXAMPLE.COM/A", "HTTPS://EXAMPLE.COM/A", "大文字のスキームも受け付け、書いたとおり返す"],
  ["/%0A/evil.example.com/", "/%0A/evil.example.com/", "エンコード済みの改行はパスとして正当"],

  [null, null, "null"],
  [undefined, null, "undefined"],
  [42, null, "文字列でない値"],
  [{}, null, "オブジェクト"],
  ["", null, "空"],
  ["   ", null, "空白だけ"],
  ["schedule", null, "スラッシュで始まらない相対パス"],
  ["evil.example.com/a", null, "スキームの無いホスト"],
  ["//evil.example.com/", null, "プロトコル相対"],
  ["/\\evil.example.com/", null, "スラッシュ＋バックスラッシュ（#137・#140）"],
  ["/\n/evil.example.com/", null, "生の改行（#140）"],
  ["/\t/evil.example.com/", null, "生のタブ"],
  ["/\r/evil.example.com/", null, "生の復帰"],
  ["javascript:alert(1)", null, "javascript:"],
  ["JavaScript:alert(1)", null, "大文字のjavascript:"],
  [" javascript:alert(1)", null, "前に空白のあるjavascript:"],
  ["java\nscript:alert(1)", null, "途中に改行のあるjavascript:（解釈で消えて javascript: になる）"],
  ["data:text/html,<script>alert(1)</script>", null, "data:"],
  ["vbscript:msgbox(1)", null, "vbscript:"],
  ["file:///etc/passwd", null, "file:"],
  ["ftp://example.com/", null, "ftp:"],
  ["https://", null, "ホストの無い絶対URL"],
  ["http://", null, "ホストの無いhttp"],
];


/** 表に無い入力も含めて、通した値が別のオリジンへ出ないことを確かめるための入力。 */
export function originEscapeCorpus(): string[] {
  const chars: string[] = [];
  for (let code = 0; code <= 0xff; code += 1) chars.push(String.fromCharCode(code));
  // 見た目がスラッシュ・空白に近い文字や、URLの解釈で扱いが特別になりうる文字。
  chars.push(" ", " ", "　", "／", "＼", "​", "﻿", "%", "@", "?", "#");

  const corpus = new Set<string>();
  for (const c of chars) {
    for (const d of chars) {
      corpus.add(`/${c}${d}evil.example.com/`);
    }
    corpus.add(`/${c}/evil.example.com/`);
    corpus.add(`/${c}evil.example.com/`);
    corpus.add(`${c}/evil.example.com/`);
    corpus.add(`/a${c}/evil.example.com/`);
    corpus.add(`/${c}`);
  }
  return [...corpus];
}

