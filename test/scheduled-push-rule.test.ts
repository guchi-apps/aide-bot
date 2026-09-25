import assert from "node:assert/strict";
import { test } from "node:test";

import { composeScheduledBody, daysToMask, isDue, maskToDays, scheduledDedupeKey } from "../src/lib/scheduled-push-rule.ts";

// 2026-09-25は金曜。日本時間で指定する。
const at = (time: string) => new Date(`2026-09-25T${time}:00+09:00`);
const created = new Date("2026-09-01T00:00:00+09:00");
const friday7 = { daysMask: daysToMask([5]), hour: 7, minute: 30, createdAt: created };

test("曜日と時刻の境目", () => {
  assert.equal(isDue(friday7, at("07:29")), false);
  assert.equal(isDue(friday7, at("07:30")), true);
  assert.equal(isDue(friday7, at("10:30")), true);
  assert.equal(isDue(friday7, at("10:31")), false, "猶予3時間を過ぎたら送らない");
  assert.equal(isDue({ ...friday7, daysMask: daysToMask([1, 2]) }, at("08:00")), false);
});

test("登録より前の時刻の分は送らない", () => {
  assert.equal(isDue({ ...friday7, createdAt: at("08:00") }, at("08:30")), false);
  assert.equal(isDue({ ...friday7, createdAt: at("07:00") }, at("08:30")), true);
});

test("日本時間の0時台でも曜日がずれない", () => {
  const sat = { daysMask: daysToMask([6]), hour: 0, minute: 0, createdAt: created };
  assert.equal(isDue(sat, new Date("2026-09-25T15:30:00Z")), true); // JST 土曜0:30
});

test("曜日のビット変換と鍵と本文", () => {
  assert.deepEqual(maskToDays(daysToMask([6, 0, 3, 3, 9])), [0, 3, 6]);
  assert.equal(scheduledDedupeKey("abc", at("07:30")), "2026-09-25:abc");
  assert.equal(composeScheduledBody(["a", "b", "c", "d"]), "・a\n・b\n・c");
});
