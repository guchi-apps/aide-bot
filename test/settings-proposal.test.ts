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
