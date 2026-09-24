/**
 * 継続記憶（#323）の判定。抽出結果の読み違い・秘密情報の混入・回答へ載せる条件を固定する。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  containsSecret,
  dedupeKeyOf,
  formatMemoryBlock,
  isUsableForAnswer,
  parseCandidates,
  parseNotionCheck,
  type PromptMemory,
  type SourceMessage,
} from "@/lib/memory-rule";

const NOW = new Date("2026-09-24T03:00:00Z");
const SOURCES: SourceMessage[] = [
  { id: "m1", content: "いつか京都の紅葉を見に行きたい", createdAt: new Date("2026-09-01T03:00:00Z") },
  { id: "m2", content: "パスワードは hunter2 です", createdAt: new Date("2026-09-02T03:00:00Z") },
];

function memory(extra: Partial<PromptMemory> = {}): PromptMemory {
  return {
    kind: "WISH",
    content: "京都の紅葉を見に行く",
    status: "CONFIRMED",
    sourceAt: new Date("2026-09-01T03:00:00Z"),
    updatedAt: new Date("2026-09-10T03:00:00Z"),
    notionStatus: null,
    notionCheckedAt: null,
    ...extra,
  };
}

describe("parseCandidates", () => {
  it("出典の発言から引用と日時を取り、確度の読めない値は低へ倒す", () => {
    const result = parseCandidates(
      '前置き [{"kind":"wish","content":"京都の紅葉を見に行く","confidence":"???","sourceId":"m1"}] 後書き',
      SOURCES,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].kind, "WISH");
    assert.equal(result[0].confidence, "LOW");
    assert.equal(result[0].sourceQuote, SOURCES[0].content);
    assert.deepEqual(result[0].sourceAt, SOURCES[0].createdAt);
  });

  it("出典が渡した発言に無いもの・秘密情報を含むものは捨てる", () => {
    const result = parseCandidates(
      JSON.stringify([
        { kind: "WISH", content: "どこか", confidence: "HIGH", sourceId: "nope" },
        { kind: "DECISION", content: "パスワードを変えない", confidence: "HIGH", sourceId: "m1" },
        { kind: "DECISION", content: "方針を決めた", confidence: "HIGH", sourceId: "m2" },
      ]),
      SOURCES,
    );
    assert.deepEqual(result, []);
  });

  it("読めない返答・同じ内容の重複は何も足さない／1件にまとめる", () => {
    assert.deepEqual(parseCandidates("なし", SOURCES), []);
    const twice = parseCandidates(
      JSON.stringify([
        { kind: "WISH", content: "京都へ行く", sourceId: "m1" },
        { kind: "WISH", content: "京都へ、行く。", sourceId: "m1" },
      ]),
      SOURCES,
    );
    assert.equal(twice.length, 1);
  });
});

describe("containsSecret / dedupeKeyOf", () => {
  it("秘密情報らしいものを見つける", () => {
    assert.equal(containsSecret("APIキーは sk-abcdefghijklmnopqrstuv"), true);
    assert.equal(containsSecret("カード番号 4111 1111 1111 1111"), true);
    assert.equal(containsSecret("京都の紅葉を見に行きたい"), false);
  });

  it("空白・句読点・全半角の違いは同じ内容として扱う", () => {
    assert.equal(dedupeKeyOf("Ｋyoto へ 行く。"), dedupeKeyOf("kyotoへ行く"));
  });
});

describe("回答へ載せる条件", () => {
  it("確定以外は使わない（候補・見送り・忘れた）", () => {
    for (const status of ["CANDIDATE", "DISMISSED", "FORGOTTEN"] as const) {
      assert.equal(isUsableForAnswer(memory({ status })), false);
    }
    assert.equal(isUsableForAnswer(memory()), true);
  });

  it("Notionで達成・見送りの希望は、古い会話を根拠に使わない", () => {
    assert.equal(isUsableForAnswer(memory({ notionStatus: "done" })), false);
    assert.equal(isUsableForAnswer(memory({ notionStatus: "skipped" })), false);
    assert.equal(isUsableForAnswer(memory({ notionStatus: "open" })), true);
  });

  it("出典と更新日を添え、Notionの状態が確認できていないことを書く", () => {
    const block = formatMemoryBlock([memory(), memory({ status: "FORGOTTEN", content: "忘れたもの" })], NOW);
    assert.match(block, /元の発言 2026-09-01/);
    assert.match(block, /更新 2026-09-10/);
    assert.match(block, /Notionでの状態は確認できていない/);
    assert.doesNotMatch(block, /忘れたもの/);
  });

  it("確認が古いときは「以降確認できていない」と書く。使える記憶が無ければ空", () => {
    const stale = memory({ notionStatus: "open", notionCheckedAt: new Date("2026-08-01T00:00:00Z") });
    assert.match(formatMemoryBlock([stale], NOW), /以降確認できていない/);
    assert.equal(formatMemoryBlock([memory({ status: "CANDIDATE" })], NOW), "");
  });
});

describe("parseNotionCheck", () => {
  it("対象のIDと知っている状態だけを読む", () => {
    const result = parseNotionCheck(
      JSON.stringify([
        { id: "a", status: "done", url: "https://notion.so/x" },
        { id: "b", status: "weird" },
        { id: "z", status: "open" },
        { id: "a2", status: "open", url: "javascript:alert(1)" },
      ]),
      ["a", "b", "a2"],
    );
    assert.deepEqual([...result.keys()], ["a", "a2"]);
    assert.equal(result.get("a")?.url, "https://notion.so/x");
    assert.equal(result.get("a2")?.url, null);
  });
});
