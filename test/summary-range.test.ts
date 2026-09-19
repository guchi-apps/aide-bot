/**
 * 日を消したとき、要約へ畳んだ範囲から引く件数（#157・#245・#265）。
 *
 * 畳んだ範囲は「いちばん古い `summarizedCount` 件」。この計算がずれると、畳んでいない発言まで
 * 読み飛ばされる（多く引いた場合）か、要約にも履歴にも入らない発言ができる（少なく引いた場合）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { removedFromSummary } from "@/lib/summary-range";

describe("removedFromSummary", () => {
  it("畳んだ範囲より新しい日を消しても引かない", () => {
    // 古い10件が畳んである。消す日の前に10件以上ある。
    assert.equal(removedFromSummary(10, 10, 5), 0);
    assert.equal(removedFromSummary(10, 20, 5), 0);
  });

  it("畳んでいない発言が無い（畳んだ件数が0）なら引かない", () => {
    assert.equal(removedFromSummary(0, 0, 5), 0);
  });

  it("畳んだ範囲にすっぽり入る日は、消す件数をそのまま引く", () => {
    // 古い30件が畳んである。消す日の前に10件あり、その日の5件は11〜15件目。
    assert.equal(removedFromSummary(30, 10, 5), 5);
  });

  it("畳んだ範囲の境目をまたぐ日は、範囲に入っていたぶんだけ引く", () => {
    // 古い12件が畳んである。消す日の前に10件あり、その日の5件のうち畳んだのは11・12件目の2件。
    assert.equal(removedFromSummary(12, 10, 5), 2);
    // 先頭の日を消す。畳んだ範囲の3件はすべて入っている。
    assert.equal(removedFromSummary(3, 0, 5), 3);
  });

  it("畳んだ範囲の終わりぴったりで終わる日は、全件を引く", () => {
    assert.equal(removedFromSummary(15, 10, 5), 5);
  });

  it("畳んだ範囲の直後から始まる日は引かない", () => {
    assert.equal(removedFromSummary(10, 10, 3), 0);
  });

  it("結果は0以上・消す件数以下に収まる", () => {
    for (let summarized = 0; summarized <= 12; summarized += 1) {
      for (let older = 0; older <= 12; older += 1) {
        for (let day = 0; day <= 12; day += 1) {
          const removed = removedFromSummary(summarized, older, day);
          assert.ok(removed >= 0 && removed <= day, `summarized=${summarized} older=${older} day=${day} → ${removed}`);
        }
      }
    }
  });

  it("日を消した後も、畳んだ範囲は「残った発言の先頭から数えた件数」と食い違わない", () => {
    // 発言に通し番号を振り、古い方から `summarized` 件を畳んだことにして、連続する `day` 件を実際に消す。
    // 引いた後の件数で数え直した先頭が、消す前に畳んでいた発言だけを指していなければならない。
    for (let total = 0; total <= 10; total += 1) {
      for (let summarized = 0; summarized <= total; summarized += 1) {
        for (let older = 0; older <= total; older += 1) {
          for (let day = 1; older + day <= total; day += 1) {
            const before = Array.from({ length: total }, (_, index) => index);
            const foldedBefore = new Set(before.slice(0, summarized));
            const remaining = before.filter((index) => index < older || index >= older + day);

            const after = summarized - removedFromSummary(summarized, older, day);
            const label = `total=${total} summarized=${summarized} older=${older} day=${day}`;
            // 畳んでいた発言が、畳んだ範囲の外へ押し出されていない（読み飛ばしが足りない）
            assert.ok(remaining.slice(0, after).every((index) => foldedBefore.has(index)), `範囲が食い込んだ: ${label}`);
            // 畳んでいなかった発言が、畳んだ範囲へ入っていない（読み飛ばしすぎ）
            assert.ok(remaining.slice(after).every((index) => !foldedBefore.has(index)), `畳んだ発言が範囲の外へ出た: ${label}`);
          }
        }
      }
    }
  });
});
