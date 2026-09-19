/**
 * リクエスト本文の読み取り（#262）。
 *
 * 本文が JSON の `null` のとき、`(await request.json()) as Body` のまま `body.x` を読むと
 * TypeErrorで500になる。画面からは出ない入力（外部アプリ・手で叩いた場合）なので、
 * **形が違う本文は必ず `null` になる**ことを表で固定する。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isJsonObject, readJsonObject } from "@/lib/json-body";

function post(body: string): Request {
  return new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("readJsonObject", () => {
  it("オブジェクトはそのまま返す", async () => {
    assert.deepEqual(await readJsonObject(post('{"message":"こんにちは"}')), { message: "こんにちは" });
    assert.deepEqual(await readJsonObject(post("{}")), {});
  });

  it("null・数値・文字列・真偽値・配列はnullにする", async () => {
    for (const raw of ["null", "0", "123", '"text"', "true", "false", "[]", '[{"message":"x"}]']) {
      assert.equal(await readJsonObject(post(raw)), null, raw);
    }
  });

  it("JSONとして読めない本文と空の本文はnullにする", async () => {
    for (const raw of ["", "{", "undefined", "not json"]) {
      assert.equal(await readJsonObject(post(raw)), null, JSON.stringify(raw));
    }
  });
});

describe("isJsonObject", () => {
  it("通すのは配列でないオブジェクトだけ", () => {
    assert.equal(isJsonObject({}), true);
    assert.equal(isJsonObject({ a: 1 }), true);
    assert.equal(isJsonObject(null), false);
    assert.equal(isJsonObject(undefined), false);
    assert.equal(isJsonObject([]), false);
    assert.equal(isJsonObject("x"), false);
    assert.equal(isJsonObject(1), false);
  });
});
