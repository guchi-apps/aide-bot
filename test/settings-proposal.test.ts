import assert from "node:assert/strict";
import { test } from "node:test";

import { extractProposal, stripProposal, validateChange } from "../src/lib/settings-proposal.ts";

const fence = (json: string) => "承知しました。\n\n```settings-change\n" + json + "\n```\n";

test("朝の見通しの時刻の案を取り出し、囲みを本文から除く", () => {
  const { text, changes } = extractProposal(fence('{"changes":[{"key":"briefing_time","hour":6,"minute":30}]}'));
  assert.equal(text, "承知しました。");
  assert.deepEqual(changes, [{ key: "briefing_time", hour: 6, minute: 30 }]);
});

test("不正な値・知らない項目・壊れたJSONは案として使わない", () => {
  assert.equal(validateChange({ key: "briefing_time", hour: 25, minute: 0 }), null);
  assert.equal(validateChange({ key: "briefing_time", hour: 6, minute: 15 }), null);
  assert.equal(validateChange({ key: "proactive" }), null);
  assert.equal(validateChange({ key: "proactive", frequency: "hourly" }), null);
  assert.equal(validateChange({ key: "user_email", value: "x" }), null);
  assert.equal(validateChange(null), null);
  assert.deepEqual(extractProposal(fence("{壊れた")).changes, []);
});

test("先回りの提案は渡した項目だけを持つ", () => {
  const change = validateChange({ key: "proactive", weekend: false, quietStart: 23, extra: 1 });
  assert.deepEqual(change, { key: "proactive", weekend: false, quietStart: 23 });
});

test("件数の上限を超えた分は捨てる", () => {
  const item = '{"key":"briefing_time","hour":7,"minute":0}';
  const { changes } = extractProposal(fence(`{"changes":[${Array(6).fill(item).join(",")}]}`));
  assert.equal(changes.length, 4);
});

test("囲みが閉じる前の途中の本文でも囲みを見せない", () => {
  assert.equal(stripProposal('確認です。\n```settings-change\n{"changes":[{"key"'), "確認です。");
});

test("ニュースの種類の追加・変更・削除の案を検証する", () => {
  assert.deepEqual(
    validateChange({ key: "topic_category", action: "add", label: "スポーツ", scope: "国内のプロ野球", extra: 1 }),
    { key: "topic_category", action: "add", label: "スポーツ", short: "スポーツ", scope: "国内のプロ野球" },
  );
  assert.deepEqual(validateChange({ key: "topic_category", action: "update", target: "技術とAI", enabled: false }), {
    key: "topic_category",
    action: "update",
    target: "技術とAI",
    enabled: false,
  });
  assert.deepEqual(validateChange({ key: "topic_category", action: "delete", target: "暮らし" }), {
    key: "topic_category",
    action: "delete",
    target: "暮らし",
  });
  // 変える項目が無い・長すぎる・型が違う・知らない操作は捨てる。
  assert.equal(validateChange({ key: "topic_category", action: "update", target: "暮らし" }), null);
  assert.equal(validateChange({ key: "topic_category", action: "update", target: "暮らし", short: "x".repeat(13) }), null);
  assert.equal(validateChange({ key: "topic_category", action: "update", target: "暮らし", enabled: "no" }), null);
  assert.equal(validateChange({ key: "topic_category", action: "add", label: "名前だけ" }), null);
  assert.equal(validateChange({ key: "topic_category", action: "purge", target: "暮らし" }), null);
});

test("定時のお知らせの追加・変更・削除の案を検証する", () => {
  assert.deepEqual(
    validateChange({ key: "scheduled_push", action: "add", days: [1, 2], hour: 8, minute: 30, category: "all" }),
    { key: "scheduled_push", action: "add", days: [1, 2], hour: 8, minute: 30, category: "all" },
  );
  assert.deepEqual(
    validateChange({ key: "scheduled_push", action: "update", target: { hour: 8 }, hour: 9, enabled: true }),
    { key: "scheduled_push", action: "update", target: { hour: 8 }, hour: 9, enabled: true },
  );
  assert.deepEqual(validateChange({ key: "scheduled_push", action: "delete", target: { category: "技術とAI" } }), {
    key: "scheduled_push",
    action: "delete",
    target: { category: "技術とAI" },
  });
  // 曜日の範囲外・分が30刻みでない・対象が空・変更が空は捨てる。
  assert.equal(validateChange({ key: "scheduled_push", action: "add", days: [7], hour: 8, minute: 0, category: "all" }), null);
  assert.equal(validateChange({ key: "scheduled_push", action: "add", days: [1], hour: 8, minute: 15, category: "all" }), null);
  assert.equal(validateChange({ key: "scheduled_push", action: "delete", target: {} }), null);
  assert.equal(validateChange({ key: "scheduled_push", action: "update", target: { hour: 8 } }), null);
});
