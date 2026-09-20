/**
 * 記録の画面から隠す自動の依頼文と、返答に添える時刻（#280）。
 *
 * 隠す判定が実際の依頼文とずれると、朝の見通しの依頼文が「自分の発言」として画面に出る。
 * 逆に広すぎると、利用者の発言が読めなくなる。時刻はサーバー（日本時間で作って渡す）と
 * ブラウザ（送信直後に足す返答）の両方で使うので、どちらの環境のタイムゾーンでも同じになること。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MORNING_BRIEFING_REQUEST, URGENT_NOTICE_REQUEST } from "@/lib/anthropic";
import { AUTO_REQUEST_PREFIX, isAutoRequest } from "@/lib/auto-request";
import { jstTimeLabel } from "@/lib/day-key";

describe("isAutoRequest", () => {
  it("朝の見通しと急ぎのお知らせの依頼文（USER）を隠す", () => {
    assert.equal(isAutoRequest("USER", MORNING_BRIEFING_REQUEST), true);
    assert.equal(isAutoRequest("USER", URGENT_NOTICE_REQUEST), true);
  });

  it("2つの依頼文は前置きから始まる（組み立てが外れていない）", () => {
    assert.ok(MORNING_BRIEFING_REQUEST.startsWith(AUTO_REQUEST_PREFIX));
    assert.ok(URGENT_NOTICE_REQUEST.startsWith(AUTO_REQUEST_PREFIX));
  });

  it("前置きを付けたあとの本文までは見ない（依頼文を書き換えても隠れ続ける）", () => {
    assert.equal(isAutoRequest("USER", "（自動）おはよう。文面が変わった後の依頼文。"), true);
  });

  it("利用者の通常の発言は隠さない", () => {
    assert.equal(isAutoRequest("USER", "洗濯物は外に干して大丈夫？"), false);
    assert.equal(isAutoRequest("USER", ""), false);
  });

  it("前置きが先頭でなければ隠さない（文中に（自動）を含む発言）", () => {
    assert.equal(isAutoRequest("USER", "これは（自動）ではなく自分の発言"), false);
    assert.equal(isAutoRequest("USER", " （自動）先頭に空白がある"), false);
  });

  it("秘書の返答（ASSISTANT）は前置きが付いていても隠さない", () => {
    assert.equal(isAutoRequest("ASSISTANT", `${AUTO_REQUEST_PREFIX}返答`), false);
  });
});

describe("jstTimeLabel", () => {
  it("日本時間の24時間表記（ゼロ埋め）で返す", () => {
    // 2026-09-19T22:00:00Z = 日本時間の2026-09-20 07:00。
    assert.equal(jstTimeLabel(new Date("2026-09-19T22:00:00Z")), "07:00");
    assert.equal(jstTimeLabel(new Date("2026-09-20T00:14:00Z")), "09:14");
  });

  it("日本時間の0時台は `00:` で、`24:` にならない", () => {
    assert.equal(jstTimeLabel(new Date("2026-09-19T15:05:00Z")), "00:05");
  });

  it("UTCの日付をまたいでも日本時間で作る", () => {
    // UTCではまだ前日の23:59。日本時間では翌日の08:59。
    assert.equal(jstTimeLabel(new Date("2026-09-19T23:59:00Z")), "08:59");
  });
});
