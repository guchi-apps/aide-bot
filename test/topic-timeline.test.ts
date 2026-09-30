import assert from "node:assert/strict";
import test from "node:test";

import { BATCH_GAP_MS, buildTimeline, unreadCount } from "../src/lib/topic-timeline.ts";

const at = (minutesAgo: number, seconds = 0) => new Date(Date.UTC(2026, 8, 30, 12, 0, 0) - minutesAgo * 60_000 + seconds * 1000);
const row = (id: string, createdAt: Date) => ({ id, createdAt });

const kinds = (entries: ReturnType<typeof buildTimeline>) =>
  entries.map((entry) => (entry.kind === "row" ? entry.row.id : entry.kind));

test("同じ回のinsertのずれ（数秒）は1つの回にまとめる", () => {
  const rows = [row("a", at(20, 0)), row("b", at(20, 3)), row("c", at(20, 6))];
  assert.deepEqual(kinds(buildTimeline(rows, null)), ["batch", "c", "b", "a"]);
});

test("間隔が2分を超えたら別の回にする（ちょうど2分は同じ回）", () => {
  const same = [row("a", at(10)), row("b", new Date(at(10).getTime() - BATCH_GAP_MS))];
  assert.deepEqual(kinds(buildTimeline(same, null)), ["batch", "a", "b"]);
  const split = [row("a", at(10)), row("b", new Date(at(10).getTime() - BATCH_GAP_MS - 1))];
  assert.deepEqual(kinds(buildTimeline(split, null)), ["batch", "a", "batch", "b"]);
});

test("見出しは回の最も古い取り込み時刻と件数を持つ", () => {
  const entries = buildTimeline([row("a", at(20, 0)), row("b", at(20, 5))], null);
  const batch = entries[0];
  assert.equal(batch.kind, "batch");
  if (batch.kind === "batch") {
    assert.equal(batch.count, 2);
    assert.equal(batch.startedAt.getTime(), at(20, 0).getTime());
  }
});

test("seenAtがnullなら全件が既読で、線も出ない", () => {
  const entries = buildTimeline([row("a", at(5)), row("b", at(300))], null);
  assert.ok(entries.every((entry) => entry.kind !== "seen" && (entry.kind !== "row" || !entry.unread)));
});

test("未読と既読の境目に線が1本だけ入る", () => {
  const rows = [row("new1", at(5)), row("new2", at(6)), row("old1", at(300)), row("old2", at(301))];
  const entries = buildTimeline(rows, at(120));
  assert.deepEqual(kinds(entries), ["batch", "new1", "new2", "seen", "batch", "old1", "old2"]);
  assert.equal(entries.filter((entry) => entry.kind === "seen").length, 1);
});

test("同じ回の途中が境目でも、見出しを重ねずに線だけ入る", () => {
  const rows = [row("a", at(10, 10)), row("b", at(10, 5)), row("c", at(10, 0))];
  const entries = buildTimeline(rows, at(10, 7));
  assert.deepEqual(kinds(entries), ["batch", "a", "seen", "b", "c"]);
});

test("全件が未読なら線は出ない（直後に既読が無い）", () => {
  const entries = buildTimeline([row("a", at(5)), row("b", at(6))], at(120));
  assert.ok(entries.every((entry) => entry.kind !== "seen"));
});

test("seenAtちょうどの記事は既読（>で判定する）", () => {
  const entries = buildTimeline([row("a", at(120))], at(120));
  const item = entries.find((entry) => entry.kind === "row");
  assert.ok(item && item.kind === "row" && !item.unread);
});

test("同時刻の並びはidで固定される", () => {
  const same = at(5);
  assert.deepEqual(kinds(buildTimeline([row("b", same), row("a", same)], null)), ["batch", "a", "b"]);
});

test("unreadCountは境目より後に取り込んだ件数を数える", () => {
  const rows = [row("a", at(5)), row("b", at(200))];
  assert.equal(unreadCount(rows, at(120)), 1);
  assert.equal(unreadCount(rows, null), 0);
});
