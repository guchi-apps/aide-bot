import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROACTIVE_CHECK_INTERVAL_MS,
  candidateFromDedupeKey,
  isQuietMinute,
  isWorkTime,
  jstWeekKey,
  parseProactiveReply,
  proactiveDedupeKey,
  proactiveGate,
} from "../src/lib/proactive-rule.ts";
import type { ProactiveSettings } from "../src/lib/proactive-labels.ts";

const settings: ProactiveSettings = {
  weekend: true,
  freeTime: true,
  ongoing: true,
  quietStart: 22,
  quietEnd: 8,
  avoidWork: true,
  frequency: "daily",
};

// 2026-09-25 は金曜、09-26 は土曜、09-23 は水曜（日本時間）。
const at = (day: string, time: string) => new Date(`2026-09-${day}T${time}:00+09:00`);
const base = { sentToday: 0, sentThisWeek: 0, lastCheckedAt: null };

test("isQuietMinute: 日をまたぐ設定と同一時刻", () => {
  assert.equal(isQuietMinute(23 * 60, 22, 8), true);
  assert.equal(isQuietMinute(7 * 60 + 59, 22, 8), true);
  assert.equal(isQuietMinute(8 * 60, 22, 8), false);
  assert.equal(isQuietMinute(21 * 60 + 59, 22, 8), false);
  assert.equal(isQuietMinute(3 * 60, 8, 8), false);
});

test("isWorkTime: 平日の8〜19時だけ", () => {
  assert.equal(isWorkTime(5, 12 * 60), true);
  assert.equal(isWorkTime(5, 19 * 60), false);
  assert.equal(isWorkTime(6, 12 * 60), false);
  assert.equal(isWorkTime(0, 12 * 60), false);
});

test("proactiveGate: 金曜の勤務後は週末の提案も対象", () => {
  const gate = proactiveGate({ ...base, now: at("25", "19:30"), settings });
  assert.deepEqual(gate, { run: true, kinds: ["weekend", "free_time", "ongoing"] });
});

test("proactiveGate: 水曜は週末の提案を考えない", () => {
  const gate = proactiveGate({ ...base, now: at("23", "20:00"), settings });
  assert.deepEqual(gate, { run: true, kinds: ["free_time", "ongoing"] });
});

test("proactiveGate: 静音・勤務帯・種類オフで呼ばない", () => {
  assert.equal(proactiveGate({ ...base, now: at("26", "23:00"), settings }).run, false);
  assert.equal(proactiveGate({ ...base, now: at("25", "12:00"), settings }).run, false);
  assert.equal(proactiveGate({ ...base, now: at("26", "12:00"), settings: { ...settings, avoidWork: true } }).run, true);
  const off = { ...settings, weekend: false, freeTime: false, ongoing: false };
  assert.equal(proactiveGate({ ...base, now: at("26", "12:00"), settings: off }).run, false);
});

test("proactiveGate: 頻度の上限と判定間隔", () => {
  const now = at("26", "12:00");
  assert.equal(proactiveGate({ ...base, now, settings, sentToday: 1 }).run, false);
  assert.equal(proactiveGate({ ...base, now, settings: { ...settings, frequency: "twice_weekly" }, sentThisWeek: 2 }).run, false);
  assert.equal(proactiveGate({ ...base, now, settings: { ...settings, frequency: "twice_weekly" }, sentThisWeek: 1 }).run, true);
  assert.equal(proactiveGate({ ...base, now, settings: { ...settings, frequency: "weekly" }, sentThisWeek: 1 }).run, false);

  const recent = new Date(now.getTime() - PROACTIVE_CHECK_INTERVAL_MS + 1);
  assert.equal(proactiveGate({ ...base, now, settings, lastCheckedAt: recent }).run, false);
  const older = new Date(now.getTime() - PROACTIVE_CHECK_INTERVAL_MS);
  assert.equal(proactiveGate({ ...base, now, settings, lastCheckedAt: older }).run, true);
});

test("jstWeekKey: 月曜始まり", () => {
  assert.equal(jstWeekKey(at("21", "09:00")), "2026-09-21");
  assert.equal(jstWeekKey(at("27", "23:59")), "2026-09-21");
  assert.equal(jstWeekKey(at("28", "00:00")), "2026-09-28");
});

test("parseProactiveReply: 正しい形と、黙る形", () => {
  const allowed = ["weekend", "free_time"] as const;
  const ok = parseProactiveReply("weekend|映画を観る|09-27 10:00-16:00\n土曜の午後が空いています。", allowed);
  assert.deepEqual(ok, {
    kind: "weekend",
    candidate: "映画を観る",
    fingerprint: "09-27_10_00-16_00",
    text: "土曜の午後が空いています。",
  });

  assert.equal(parseProactiveReply("NO_SUGGESTION", allowed), null);
  assert.equal(parseProactiveReply("ongoing|a|b\n本文", allowed), null); // オフの種類
  assert.equal(parseProactiveReply("weekend|a|b", allowed), null); // 本文なし
  assert.equal(parseProactiveReply("確認します\nweekend|a|b\n本文", allowed), null);
  assert.equal(parseProactiveReply("weekend||b\n本文", allowed), null);
  assert.equal(parseProactiveReply(`weekend|a|b\n${"あ".repeat(601)}`, allowed), null);
});

test("dedupeKey: 同じ週・候補・予定状態で同じ、状態や週が変われば変わる", () => {
  const s = { kind: "weekend" as const, candidate: "映画", fingerprint: "a", text: "x" };
  const key = proactiveDedupeKey(s, at("25", "19:30"));
  assert.equal(key, proactiveDedupeKey(s, at("26", "10:00")));
  assert.notEqual(key, proactiveDedupeKey({ ...s, fingerprint: "b" }, at("26", "10:00")));
  assert.notEqual(key, proactiveDedupeKey(s, at("28", "10:00")));
  assert.ok(key.length <= 120);
  assert.equal(candidateFromDedupeKey(key), "映画");
  assert.equal(candidateFromDedupeKey("bad"), null);
});
