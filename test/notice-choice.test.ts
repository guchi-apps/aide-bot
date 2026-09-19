/**
 * お知らせ選定でのモデルの返答の読み取り（#93・#265）。
 *
 * 知らない形で返ってきた回は**黙る**のが決まり。読み違えると、前置きの一文がそのまま吹き出しに
 * 出たり、番号として読めないものを0番と見なして関係の無いお知らせを消費したりする。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOTICE_SKIP_TOKEN, NOTICE_URGENT_MARK } from "@/lib/anthropic";
import { parseChoice } from "@/lib/notice-choice";

describe("parseChoice", () => {
  it("1行目の番号（1始まり）と2行目の文を読む", () => {
    assert.deepEqual(parseChoice("2\n洗濯物を取り込む時間です", 3), {
      index: 1,
      urgent: false,
      text: "洗濯物を取り込む時間です",
    });
  });

  it("番号の後ろの急ぎの印を読む", () => {
    assert.deepEqual(parseChoice(`1 ${NOTICE_URGENT_MARK}\nあと8分で出発です`, 1), {
      index: 0,
      urgent: true,
      text: "あと8分で出発です",
    });
  });

  it("知らない印は急ぎとして扱わない", () => {
    assert.deepEqual(parseChoice("1 urgent\nこんにちは", 1), { index: 0, urgent: false, text: "こんにちは" });
  });

  it("空行と前後の空白を無視し、2行目以降は1行につなぐ", () => {
    assert.deepEqual(parseChoice("\n  3  \n\n  一言目  \n  二言目\n", 3), {
      index: 2,
      urgent: false,
      text: "一言目 二言目",
    });
  });

  it("スキップの印だけなら黙る", () => {
    assert.equal(parseChoice(NOTICE_SKIP_TOKEN, 3), null);
    assert.equal(parseChoice(`  ${NOTICE_SKIP_TOKEN}\n余計な文`, 3), null);
  });

  it("空の返答なら黙る", () => {
    assert.equal(parseChoice("", 3), null);
    assert.equal(parseChoice("  \n \n", 3), null);
  });

  it("番号が範囲の外なら黙る（0番・候補数超過・負数）", () => {
    assert.equal(parseChoice("0\n本文", 3), null);
    assert.equal(parseChoice("4\n本文", 3), null);
    assert.equal(parseChoice("-1\n本文", 3), null);
  });

  it("番号として読めない1行目なら黙る（前置き・全角・小数）", () => {
    assert.equal(parseChoice("選びました\n2\n本文", 3), null);
    assert.equal(parseChoice("２\n本文", 3), null);
    assert.equal(parseChoice("1.5\n本文", 3), null);
    assert.equal(parseChoice("番号: 1\n本文", 3), null);
  });

  it("番号と印のほかに余計な語が続く1行目なら黙る", () => {
    assert.equal(parseChoice(`1 ${NOTICE_URGENT_MARK} 追加\n本文`, 3), null);
  });

  it("本文が無ければ黙る", () => {
    assert.equal(parseChoice("1", 3), null);
    assert.equal(parseChoice(`1 ${NOTICE_URGENT_MARK}\n\n`, 3), null);
  });

  it("候補が0件なら何も選ばない", () => {
    assert.equal(parseChoice("1\n本文", 0), null);
  });
});
