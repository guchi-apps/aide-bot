import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fromNotionPage, isTaskDate, normalizeTaskId, parseTaskCreate, parseTaskPatch, toNotionProperties } from "../src/lib/task-input.ts";

describe("isTaskDate", () => {
  const ok = ["2026-09-30", "2026-09-30T09:00:00+09:00", "2026-09-30T00:00Z", "2028-02-29"];
  const ng = ["2026-13-99", "2026-02-31", "2026-09-30T09:00:00", "9/30", "", "2026-09-30 09:00", "2027-02-29"];
  for (const value of ok) it(`受け付ける: ${value}`, () => assert.equal(isTaskDate(value), true));
  for (const value of ng) it(`落とす: ${value}`, () => assert.equal(isTaskDate(value), false));
});

describe("normalizeTaskId", () => {
  it("ハイフンの有無・大文字を揃える", () => {
    const expected = "3be506de-73c3-81be-a15b-f560fe7d28b9";
    assert.equal(normalizeTaskId("3be506de73c381bea15bf560fe7d28b9"), expected);
    assert.equal(normalizeTaskId("3BE506DE-73C3-81BE-A15B-F560FE7D28B9"), expected);
  });
  it("形の違う値は null", () => {
    for (const value of ["", "abc", 1, null, undefined, "../pages", "3be506de73c381bea15bf560fe7d28bz"]) {
      assert.equal(normalizeTaskId(value), null);
    }
  });
});

describe("parseTaskCreate", () => {
  it("title だけで追加できる（既定は空のタグ・未完了）", () => {
    const parsed = parseTaskCreate({ title: "  牛乳を買う  " });
    assert.deepEqual(parsed, {
      ok: true,
      value: { title: "牛乳を買う", memo: null, tags: [], priority: null, plannedDate: null, dueDate: null, repeat: null, done: false, status: null },
    });
  });
  it("title が無い・空は断る", () => {
    assert.equal(parseTaskCreate({}).ok, false);
    assert.equal(parseTaskCreate({ title: "  " }).ok, false);
  });
  it("知らない項目・選択肢・日付を項目名つきで断る", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ title: "a", extra: 1 }, "extra"],
      [{ title: "a", priority: "最高" }, "priority"],
      [{ title: "a", tags: ["仕事", "旅行"] }, "tags"],
      [{ title: "a", repeat: "隔週" }, "repeat"],
      [{ title: "a", dueDate: "2026-13-99" }, "dueDate"],
      [{ title: "a", done: "yes" }, "done"],
      [{ title: "a".repeat(201) }, "title"],
    ];
    for (const [body, field] of cases) {
      const parsed = parseTaskCreate(body);
      assert.equal(parsed.ok, false);
      if (!parsed.ok) assert.ok(parsed.error.includes(field), parsed.error);
    }
  });
  it("タグの重複は1つにまとめる", () => {
    const parsed = parseTaskCreate({ title: "a", tags: ["生活", "生活"] });
    assert.deepEqual(parsed.ok && parsed.value.tags, ["生活"]);
  });
});

describe("parseTaskPatch", () => {
  it("項目が1つも無ければ断る", () => assert.equal(parseTaskPatch({}).ok, false));
  it("title を null にはできない", () => assert.equal(parseTaskPatch({ title: null }).ok, false));
  it("null は空にする指定として通す", () => {
    const parsed = parseTaskPatch({ memo: null, dueDate: null, priority: null });
    assert.deepEqual(parsed, { ok: true, value: { memo: null, dueDate: null, priority: null } });
  });
});

describe("toNotionProperties / fromNotionPage", () => {
  it("渡した項目だけをNotionのプロパティにする", () => {
    assert.deepEqual(toNotionProperties({ done: true }), { 完了: { checkbox: true } });
    assert.deepEqual(toNotionProperties({ dueDate: null, priority: "高" }), {
      期限: { date: null },
      優先度: { select: { name: "高" } },
    });
    assert.deepEqual(toNotionProperties({ memo: null, tags: ["仕事"] }), {
      メモ: { rich_text: [] },
      タグ: { multi_select: [{ name: "仕事" }] },
    });
  });
  it("Notionのページを返す形に直す", () => {
    const view = fromNotionPage({
      id: "x",
      url: "https://notion.so/x",
      properties: {
        タイトル: { title: [{ plain_text: "ごみ" }, { plain_text: "出し" }] },
        メモ: { rich_text: [] },
        タグ: { multi_select: [{ name: "生活" }] },
        予定日: { date: { start: "2026-08-24T21:00:00.000Z" } },
        期限: { date: null },
        完了: { checkbox: true },
        繰り返し: { select: { name: "毎週" } },
        優先度: { select: null },
      },
    });
    assert.deepEqual(view, {
      id: "x",
      url: "https://notion.so/x",
      title: "ごみ出し",
      memo: null,
      tags: ["生活"],
      priority: null,
      plannedDate: "2026-08-24T21:00:00.000Z",
      dueDate: null,
      repeat: "毎週",
      done: true,
      status: null,
    });
  });
});
