/**
 * お知らせ選定を呼び直すかどうかの判定（#93・#227）。
 *
 * 黙った回の後に、候補が変わっていないのに10分ごとにCodexを呼び直さないこと、そのうえで
 * 呼び直すべき場面（候補の増加・60分経過・時間帯の変化・期限の接近・急ぎ）では呼ぶこと。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NoticePriority } from "@prisma/client";

import {
  expiryBand,
  noticeSlot,
  recordRun,
  shouldGenerate,
  type ScheduleCandidate,
} from "@/lib/notice-schedule";

const MIN = 60 * 1000;

/** 日本時間 2026-09-21 12:00（昼）。 */
const BASE = new Date("2026-09-21T03:00:00Z");
const after = (minutes: number) => new Date(BASE.getTime() + minutes * MIN);

function candidate(id: string, extra: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return { id, priority: NoticePriority.NORMAL, expiresAt: null, ...extra };
}

describe("shouldGenerate", () => {
  it("候補が0件なら呼ばない", () => {
    assert.equal(shouldGenerate(undefined, [], BASE), false);
  });

  it("一度も呼んでいなければ呼ぶ", () => {
    assert.equal(shouldGenerate(undefined, [candidate("a")], BASE), true);
  });

  it("10分あけるまでは呼ばない（黙った回でも選んだ回でも）", () => {
    const pending = [candidate("a")];
    for (const silent of [true, false]) {
      const last = recordRun(pending, BASE, silent);
      assert.equal(shouldGenerate(last, pending, after(9)), false);
    }
  });

  describe("前回が黙った回", () => {
    it("候補が同じなら、10分・30分経っても呼ばない", () => {
      const pending = [candidate("a"), candidate("b")];
      const last = recordRun(pending, BASE, true);
      assert.equal(shouldGenerate(last, pending, after(10)), false);
      assert.equal(shouldGenerate(last, pending, after(30)), false);
      assert.equal(shouldGenerate(last, pending, after(59)), false);
    });

    it("前回の候補に入っていなかったものが増えたら、10分後に呼ぶ", () => {
      const last = recordRun([candidate("a")], BASE, true);
      assert.equal(shouldGenerate(last, [candidate("a"), candidate("b")], after(10)), true);
    });

    it("増えた回でも、10分あけるまでは呼ばない（通常の急ぎでない限り）", () => {
      const last = recordRun([candidate("a")], BASE, true);
      assert.equal(shouldGenerate(last, [candidate("a"), candidate("b")], after(5)), false);
    });

    it("候補が減っただけ（期限切れ・出し終えた）なら呼ばない", () => {
      const last = recordRun([candidate("a"), candidate("b")], BASE, true);
      assert.equal(shouldGenerate(last, [candidate("a")], after(20)), false);
    });

    it("60分経ったら、候補が同じでも呼ぶ", () => {
      const pending = [candidate("a")];
      const last = recordRun(pending, BASE, true);
      assert.equal(shouldGenerate(last, pending, after(60)), true);
    });

    it("時間帯が変わったら、60分未満でも呼ぶ", () => {
      const pending = [candidate("a")];
      // 日本時間 14:50（昼）に黙った。15:00を過ぎると夕方。
      const at = new Date("2026-09-21T05:50:00Z");
      const last = recordRun(pending, at, true);
      assert.equal(shouldGenerate(last, pending, new Date("2026-09-21T05:59:00Z")), false);
      assert.equal(shouldGenerate(last, pending, new Date("2026-09-21T06:01:00Z")), true);
    });

    it("期限が60分以内に迫ったら、一度だけ呼ぶ", () => {
      const expiresAt = new Date(BASE.getTime() + 80 * MIN);
      const pending = [candidate("a", { expiresAt })];
      const first = recordRun(pending, BASE, true);
      // 残り70分：まだ60分より先
      assert.equal(shouldGenerate(first, pending, after(10)), false);
      // 残り60分：しきい値を越えた
      assert.equal(shouldGenerate(first, pending, after(20)), true);

      // その回でも黙った。残り50分・40分では呼ばない。
      const second = recordRun(pending, after(20), true);
      assert.equal(shouldGenerate(second, pending, after(30)), false);
      assert.equal(shouldGenerate(second, pending, after(40)), false);
      // 残り15分：次のしきい値を越えた
      assert.equal(shouldGenerate(second, pending, after(65)), true);
    });

    it("最初から期限が近い候補は、それだけでは呼び直さない", () => {
      const expiresAt = new Date(BASE.getTime() + 50 * MIN);
      const pending = [candidate("a", { expiresAt })];
      const last = recordRun(pending, BASE, true);
      assert.equal(shouldGenerate(last, pending, after(10)), false);
    });

    it("前回の候補に入っていない急ぎは、10分未満でも1分あければ呼ぶ", () => {
      const last = recordRun([candidate("a")], BASE, true);
      const pending = [candidate("a"), candidate("u", { priority: NoticePriority.URGENT })];
      assert.equal(shouldGenerate(last, pending, new Date(BASE.getTime() + 30 * 1000)), false);
      assert.equal(shouldGenerate(last, pending, after(1)), true);
    });

    it("前回の候補に入っていた急ぎは、急ぎの割り込みにならない", () => {
      const pending = [candidate("u", { priority: NoticePriority.URGENT })];
      const last = recordRun(pending, BASE, true);
      assert.equal(shouldGenerate(last, pending, after(1)), false);
      assert.equal(shouldGenerate(last, pending, after(30)), false);
    });
  });

  describe("前回が何かを選んだ回", () => {
    it("残りの順番待ちを、従来どおり10分おきに進める", () => {
      const last = recordRun([candidate("a"), candidate("b")], BASE, false);
      // 選ばれた a は shownAt が入って候補から外れた
      assert.equal(shouldGenerate(last, [candidate("b")], after(9)), false);
      assert.equal(shouldGenerate(last, [candidate("b")], after(10)), true);
    });
  });
});

describe("expiryBand", () => {
  it("期限が無ければ0", () => {
    assert.equal(expiryBand(null, BASE), 0);
  });

  it("60分より先は0、60分以内は1、15分以内は2", () => {
    assert.equal(expiryBand(new Date(BASE.getTime() + 61 * MIN), BASE), 0);
    assert.equal(expiryBand(new Date(BASE.getTime() + 60 * MIN), BASE), 1);
    assert.equal(expiryBand(new Date(BASE.getTime() + 16 * MIN), BASE), 1);
    assert.equal(expiryBand(new Date(BASE.getTime() + 15 * MIN), BASE), 2);
    assert.equal(expiryBand(new Date(BASE.getTime() + 1 * MIN), BASE), 2);
  });
});

describe("noticeSlot", () => {
  it("日本時間で時間帯を決める（UTCの時刻に引きずられない）", () => {
    // UTC 20:00 = 日本時間 翌5:00
    assert.equal(noticeSlot(new Date("2026-09-20T20:00:00Z")), "morning");
    assert.equal(noticeSlot(new Date("2026-09-20T19:59:00Z")), "late");
    assert.equal(noticeSlot(new Date("2026-09-21T02:00:00Z")), "noon");
    assert.equal(noticeSlot(new Date("2026-09-21T06:00:00Z")), "evening");
    assert.equal(noticeSlot(new Date("2026-09-21T10:00:00Z")), "night");
    // 日本時間 0:00（24時制で "24" を返す環境差の対策）
    assert.equal(noticeSlot(new Date("2026-09-20T15:00:00Z")), "late");
  });
});
