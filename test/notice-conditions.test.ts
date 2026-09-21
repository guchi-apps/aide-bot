/**
 * 「いま出せるお知らせ」の条件（#229）。
 *
 * 秘書の選定・一覧の画面・件数が同じ条件を読むための共通化なので、条件の**意味**を固定する。
 * DBは使わず、Prismaの `where` のうち条件が使う範囲（等値・`null`・`gt`・`lte`・`OR`・`AND`）だけを
 * 行に当てて評価する。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NOTICE_DISPLAY_TTL_MS,
  currentNoticeWhere,
  isWithinShowWindow,
  pendingNoticeWhere,
  waitingNoticeWhere,
} from "@/lib/notice-conditions";

type Row = { userId: string; shownAt: Date | null; showAt: Date | null; expiresAt: Date | null };

const NOW = new Date("2026-09-21T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60 * 1000);

/** 条件が使うぶんだけのPrisma `where` の評価。知らない形が来たら落とす（黙って通さない）。 */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Record<string, unknown>[]).some((w) => matches(row, w));
    if (key === "AND") return (condition as Record<string, unknown>[]).every((w) => matches(row, w));

    const value = (row as Record<string, unknown>)[key];
    if (condition === null) return value === null;
    if (typeof condition === "string") return value === condition;

    const { gt, lte, ...rest } = condition as { gt?: Date; lte?: Date };
    assert.deepEqual(rest, {}, `未対応の条件: ${key}`);
    if (!(value instanceof Date)) return false;
    if (gt !== undefined && !(value > gt)) return false;
    if (lte !== undefined && !(value <= lte)) return false;
    return true;
  });
}

const base: Row = { userId: "u1", shownAt: null, showAt: null, expiresAt: null };

describe("pendingNoticeWhere（未読で、いま出せる）", () => {
  const where = pendingNoticeWhere("u1", NOW) as Record<string, unknown>;

  it("表示時刻も期限も無いものは出せる", () => {
    assert.equal(matches(base, where), true);
  });

  it("表示時刻が来ていて、期限がこれからのものは出せる", () => {
    assert.equal(matches({ ...base, showAt: minutes(-1), expiresAt: minutes(1) }, where), true);
  });

  it("表示時刻ちょうどのものは出せる（lte）", () => {
    assert.equal(matches({ ...base, showAt: NOW }, where), true);
  });

  it("表示時刻がまだ先のものは出せない", () => {
    assert.equal(matches({ ...base, showAt: minutes(1) }, where), false);
  });

  it("期限ちょうど・期限切れのものは出せない（gt）", () => {
    assert.equal(matches({ ...base, expiresAt: NOW }, where), false);
    assert.equal(matches({ ...base, expiresAt: minutes(-1) }, where), false);
  });

  it("すでに出したものは出せない", () => {
    assert.equal(matches({ ...base, shownAt: minutes(-5) }, where), false);
  });

  it("ほかの利用者のものは出せない", () => {
    assert.equal(matches({ ...base, userId: "u2" }, where), false);
  });
});

describe("waitingNoticeWhere（未読だが、まだ出せない）", () => {
  const where = waitingNoticeWhere("u1", NOW) as Record<string, unknown>;

  it("表示時刻がまだ先で、期限がこれからのものだけが当たる", () => {
    assert.equal(matches({ ...base, showAt: minutes(1) }, where), true);
    assert.equal(matches({ ...base, showAt: minutes(1), expiresAt: minutes(30) }, where), true);
    assert.equal(matches(base, where), false);
    assert.equal(matches({ ...base, showAt: NOW }, where), false);
  });

  it("表示時刻が先でも、期限がそれより前に切れているものは当たらない", () => {
    assert.equal(matches({ ...base, showAt: minutes(10), expiresAt: minutes(-1) }, where), false);
  });

  it("すでに出したものは当たらない", () => {
    assert.equal(matches({ ...base, showAt: minutes(1), shownAt: minutes(-5) }, where), false);
  });
});

describe("currentNoticeWhere（いま吹き出しに出している）", () => {
  const where = currentNoticeWhere("u1", NOW) as Record<string, unknown>;

  it("出してから表示の保持時間の内にあるものが当たる", () => {
    assert.equal(matches({ ...base, shownAt: minutes(-1) }, where), true);
    assert.equal(matches({ ...base, shownAt: new Date(NOW.getTime() - NOTICE_DISPLAY_TTL_MS + 1) }, where), true);
  });

  it("保持時間を過ぎたもの・まだ出していないものは当たらない", () => {
    assert.equal(matches({ ...base, shownAt: new Date(NOW.getTime() - NOTICE_DISPLAY_TTL_MS) }, where), false);
    assert.equal(matches(base, where), false);
  });

  it("出していても、期限が切れたものは当たらない", () => {
    assert.equal(matches({ ...base, shownAt: minutes(-1), expiresAt: minutes(-1) }, where), false);
    assert.equal(matches({ ...base, shownAt: minutes(-1), expiresAt: minutes(1) }, where), true);
  });
});

describe("3つの条件は重ならない", () => {
  it("未読の行は「出せる」か「まだ出せない」のどちらか一方（または期限切れでどちらでもない）", () => {
    const pending = pendingNoticeWhere("u1", NOW) as Record<string, unknown>;
    const waiting = waitingNoticeWhere("u1", NOW) as Record<string, unknown>;
    const current = currentNoticeWhere("u1", NOW) as Record<string, unknown>;

    for (const showAt of [null, minutes(-10), NOW, minutes(10)]) {
      for (const expiresAt of [null, minutes(-5), NOW, minutes(20)]) {
        const row = { ...base, showAt, expiresAt };
        const hits = [pending, waiting].filter((where) => matches(row, where)).length;
        assert.ok(hits <= 1, `未読の行が両方に当たった: showAt=${showAt} expiresAt=${expiresAt}`);
        // 未読の行は「いま出している」に当たらない。
        assert.equal(matches(row, current), false);
      }
    }
  });
});

describe("isWithinShowWindow（JS側の判定）", () => {
  it("未読の行では、pendingNoticeWhere() と同じ結果になる", () => {
    const where = pendingNoticeWhere("u1", NOW) as Record<string, unknown>;

    for (const showAt of [null, minutes(-10), NOW, minutes(10)]) {
      for (const expiresAt of [null, minutes(-5), NOW, minutes(20)]) {
        const row = { ...base, showAt, expiresAt };
        assert.equal(
          isWithinShowWindow(row, NOW),
          matches(row, where),
          `食い違い: showAt=${showAt} expiresAt=${expiresAt}`,
        );
      }
    }
  });
});
