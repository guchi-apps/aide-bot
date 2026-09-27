import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALLOW_MESSAGE,
  DENY_MESSAGE,
  extractWriteConfirm,
  stripWriteConfirm,
  validateWriteConfirm,
  writeConfirmStatus,
} from "../src/lib/write-confirm.ts";

const json = '{"title":"予定の変更","rows":[{"label":"予定","value":"宮出運行"},{"label":"開始","value":"17:30 → 18:00"}]}';
const fence = (body: string) => "変更します。\n\n```write-confirm\n" + body + "\n```\n";

test("確認カードを取り出し、囲みを本文から除く", () => {
  const { text, confirm } = extractWriteConfirm(fence(json));
  assert.equal(text, "変更します。");
  assert.equal(confirm?.title, "予定の変更");
  assert.equal(confirm?.rows.length, 2);
});

test("不正な値・壊れたJSON・項目なしはカードにしない", () => {
  assert.equal(validateWriteConfirm({ title: "x", rows: [] }), null);
  assert.equal(validateWriteConfirm({ title: "", rows: [{ label: "a", value: "b" }] }), null);
  assert.equal(validateWriteConfirm({ title: "x", rows: [{ label: "a" }] }), null);
  assert.equal(validateWriteConfirm({ title: "x", rows: [{ label: "a", value: "b".repeat(201) }] }), null);
  assert.equal(extractWriteConfirm(fence("{壊れた")).confirm, null);
  assert.equal(extractWriteConfirm(fence("{壊れた")).text, "変更します。");
});

test("生成の途中で囲みが閉じていなくても見せない", () => {
  assert.equal(stripWriteConfirm('変更します。\n\n```write-confirm\n{"title":"予'), "変更します。");
});

const msg = (role: "USER" | "ASSISTANT", content = "", day?: string) => ({ kind: "message", role, content, day });

test("後ろに何も無い今日のカードだけ押せる", () => {
  assert.equal(writeConfirmStatus([msg("USER"), msg("ASSISTANT")], 1, "2026-09-27"), "open");
  assert.equal(writeConfirmStatus([msg("ASSISTANT", "", "2026-09-26")], 0, "2026-09-27"), "closed");
});

test("答え済みのカードは結果を返し、それ以外の発言が続いたら期限切れ", () => {
  assert.equal(writeConfirmStatus([msg("ASSISTANT"), msg("USER", ALLOW_MESSAGE)], 0, "d"), "allowed");
  assert.equal(writeConfirmStatus([msg("ASSISTANT"), msg("USER", DENY_MESSAGE)], 0, "d"), "denied");
  assert.equal(writeConfirmStatus([msg("ASSISTANT"), msg("USER", "やっぱり別の件")], 0, "d"), "closed");
});

test("会話の区切りより上のカードは押せない", () => {
  assert.equal(writeConfirmStatus([msg("ASSISTANT"), { kind: "break" }], 0, "d"), "closed");
});
