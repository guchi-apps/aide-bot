import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDLE_BREAK_HOURS, shouldAutoBreak } from "../src/lib/context-break-rule.ts";

/** 日本時間の日時（`2026-09-23T23:30`）から作る。 */
function jst(text: string): Date {
  return new Date(`${text}:00+09:00`);
}

describe("shouldAutoBreak", () => {
  it("無操作が6時間以上で、日付が変わっていれば区切る", () => {
    assert.equal(IDLE_BREAK_HOURS, 6);
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-23T23:00"),
        contextStartedAt: null,
        now: jst("2026-09-24T07:00"),
      }),
      true,
    );
  });

  it("日付をまたいでも、続けて話している最中（6時間未満）は区切らない", () => {
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-23T23:50"),
        contextStartedAt: null,
        now: jst("2026-09-24T00:20"),
      }),
      false,
    );
  });

  it("6時間あいていても、同じ日のうちは区切らない", () => {
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-24T00:10"),
        contextStartedAt: null,
        now: jst("2026-09-24T07:00"),
      }),
      false,
    );
  });

  it("ちょうど6時間なら区切り、1分足りなければ区切らない", () => {
    const last = jst("2026-09-23T20:00");
    assert.equal(shouldAutoBreak({ lastUserMessageAt: last, contextStartedAt: null, now: jst("2026-09-24T02:00") }), true);
    assert.equal(shouldAutoBreak({ lastUserMessageAt: last, contextStartedAt: null, now: jst("2026-09-24T01:59") }), false);
  });

  it("日付の境目は日本時間で見る（UTCでは同じ日でも区切る）", () => {
    // UTCでは両方とも 2026-09-23。日本時間では 23日の23:30 → 24日の08:00。
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-23T23:30"),
        contextStartedAt: null,
        now: jst("2026-09-24T08:00"),
      }),
      true,
    );
  });

  it("一度も話していない会話は区切らない", () => {
    assert.equal(
      shouldAutoBreak({ lastUserMessageAt: null, contextStartedAt: null, now: jst("2026-09-24T07:00") }),
      false,
    );
  });

  it("区切った後に利用者が話していなければ、もう一度は区切らない（自動発言では延びも繰り返しもしない）", () => {
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-23T23:00"),
        contextStartedAt: jst("2026-09-24T07:00"),
        now: jst("2026-09-24T09:00"),
      }),
      false,
    );
  });

  it("区切った後に話していれば、次の無操作でまた区切れる", () => {
    assert.equal(
      shouldAutoBreak({
        lastUserMessageAt: jst("2026-09-24T22:00"),
        contextStartedAt: jst("2026-09-24T07:00"),
        now: jst("2026-09-25T07:00"),
      }),
      true,
    );
  });
});
