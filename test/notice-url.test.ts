/**
 * お知らせの遷移先（`Notice.url`）の判定（#137・#248）。
 *
 * 積む側は他アプリで、値はこちらが書いていない文字列。`href` や `openWindow()` へ渡す前の
 * 唯一の防御なので、通す形と落とす形を表にして固定する。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isExternalNoticeUrl, safeNoticeUrl } from "@/lib/notice-url";

import { NOTICE_URL_CASES } from "./cases.ts";

describe("safeNoticeUrl", () => {
  for (const [input, expected, why] of NOTICE_URL_CASES) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}（${why}）`, () => {
      assert.equal(safeNoticeUrl(input as string | null | undefined), expected);
    });
  }
});

describe("isExternalNoticeUrl", () => {
  it("`/` で始まるものだけがアプリの中", () => {
    assert.equal(isExternalNoticeUrl("/notices"), false);
    assert.equal(isExternalNoticeUrl("https://example.com/"), true);
    assert.equal(isExternalNoticeUrl("http://localhost:3000/"), true);
  });
});
