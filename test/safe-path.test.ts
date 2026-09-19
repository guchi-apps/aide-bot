/**
 * 外から与えられる「このアプリの中のパス」の判定（#140・#248）。
 *
 * 判定を通った値は最後に `new URL(値, オリジン)` かリンクの `href` へ渡る。**通した値が別の
 * オリジンへ出ないこと**が守るべき性質なので、個々の入力の表とは別に、その性質そのものを
 * 大量の入力に対して確かめる。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isInternalPath, safeInternalPath } from "@/lib/safe-path";

import { originEscapeCorpus } from "./cases.ts";

const ORIGIN = "https://app.example";

/** [入力, 受け付けるか, 理由]。理由は失敗したときに何を確かめていたかを読めるようにするため。 */
const CASES: [string, boolean, string][] = [
  ["/", true, "ルート"],
  ["/d/2026-09-19", true, "ふつうのパス"],
  ["/settings?tab=voice#a", true, "クエリとフラグメント"],
  ["/a//b", true, "途中の連続スラッシュはパスの一部"],
  ["/%0A/evil.example.com/", true, "エンコード済みの改行はパスとして正当（解釈でも消えない）"],
  ["/%09/evil.example.com/", true, "エンコード済みのタブ"],
  ["/%5Cevil.example.com/", true, "エンコード済みのバックスラッシュ"],

  ["", false, "空"],
  ["evil.example.com", false, "スラッシュで始まらない"],
  ["https://evil.example.com/", false, "絶対URL"],
  ["javascript:alert(1)", false, "javascript:"],
  ["\\\\evil.example.com/", false, "バックスラッシュ始まり"],
  ["//evil.example.com/", false, "プロトコル相対"],
  ["/\\evil.example.com/", false, "スラッシュ＋バックスラッシュ（#140）"],
  ["/\\/evil.example.com/", false, "スラッシュ＋バックスラッシュ＋スラッシュ"],
  ["/\n/evil.example.com/", false, "生の改行（#140。解釈で消えて //evil になる）"],
  ["/\t/evil.example.com/", false, "生のタブ"],
  ["/\r/evil.example.com/", false, "生の復帰"],
  ["/ /evil.example.com/", false, "生の空白"],
  ["/\u0000/evil.example.com/", false, "NUL"],
  ["/\u007f/evil.example.com/", false, "DEL"],
  ["/a\nb", false, "途中に改行が混ざる値もまとめて落とす"],
];

describe("isInternalPath", () => {
  for (const [input, expected, why] of CASES) {
    it(`${JSON.stringify(input)} → ${expected}（${why}）`, () => {
      assert.equal(isInternalPath(input), expected);
    });
  }
});

describe("safeInternalPath", () => {
  it("null と空文字は既定へ落とす", () => {
    assert.equal(safeInternalPath(null, "/x"), "/x");
    assert.equal(safeInternalPath("", "/x"), "/x");
  });

  it("受け付ける値はそのまま返し、受け付けない値は既定へ落とす", () => {
    for (const [input, expected] of CASES) {
      if (input === "") continue;
      assert.equal(safeInternalPath(input, "/x"), expected ? input : "/x", JSON.stringify(input));
    }
  });
});

describe("isInternalPath が通した値は別のオリジンへ出ない", () => {
  it("2文字の組み合わせを総当たりしても、解釈後のオリジンが変わらない", () => {
    const corpus = originEscapeCorpus();
    assert.ok(corpus.length > 10_000, "入力が少なすぎる");

    let accepted = 0;
    for (const value of corpus) {
      if (!isInternalPath(value)) continue;
      accepted += 1;
      assert.equal(new URL(value, ORIGIN).origin, ORIGIN, JSON.stringify(value));
    }
    // 何も通さない実装でも上の検査は通ってしまうので、通すものが残っていることも確かめる。
    assert.ok(accepted > 1_000, `通した値が少なすぎる（${accepted}件）`);
  });
});
