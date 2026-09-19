/**
 * 履歴の窓の先頭の刻み（#56・#157・#248）。
 *
 * 窓を1発言ずつ滑らせるとプロンプトキャッシュが一度も効かないので、先頭は刻みでしか動かさない。
 * 件数の計算がずれると、要約と窓のあいだにすき間ができるなど、**画面に出ないまま静かに壊れる**。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HISTORY_LIMIT, HISTORY_WINDOW_STEP, historyWindowSkip } from "@/lib/anthropic";

describe("historyWindowSkip", () => {
  it("上限以下なら何も読み飛ばさない", () => {
    assert.equal(historyWindowSkip(0), 0);
    assert.equal(historyWindowSkip(1), 0);
    assert.equal(historyWindowSkip(HISTORY_LIMIT), 0);
  });

  it("上限を超えても、刻みぶん溜まるまでは動かさない", () => {
    for (let total = HISTORY_LIMIT + 1; total < HISTORY_LIMIT + HISTORY_WINDOW_STEP; total += 1) {
      assert.equal(historyWindowSkip(total), 0, `total=${total}`);
    }
  });

  it("刻みごとに先頭が動く", () => {
    assert.equal(historyWindowSkip(HISTORY_LIMIT + HISTORY_WINDOW_STEP), HISTORY_WINDOW_STEP);
    assert.equal(historyWindowSkip(HISTORY_LIMIT + HISTORY_WINDOW_STEP * 2 - 1), HISTORY_WINDOW_STEP);
    assert.equal(historyWindowSkip(HISTORY_LIMIT + HISTORY_WINDOW_STEP * 2), HISTORY_WINDOW_STEP * 2);
  });

  it("送る件数は HISTORY_LIMIT 〜 HISTORY_LIMIT + HISTORY_WINDOW_STEP - 1 に収まり、先頭は減らない", () => {
    let previous = 0;
    for (let total = HISTORY_LIMIT + 1; total <= 1000; total += 1) {
      const skip = historyWindowSkip(total);
      const sent = total - skip;

      assert.ok(sent >= HISTORY_LIMIT && sent <= HISTORY_LIMIT + HISTORY_WINDOW_STEP - 1, `total=${total} sent=${sent}`);
      assert.equal(skip % HISTORY_WINDOW_STEP, 0, `total=${total}`);
      assert.ok(skip >= previous, `total=${total}`);
      previous = skip;
    }
  });
});
