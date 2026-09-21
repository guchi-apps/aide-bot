/**
 * Codexの呼び出しが失敗したときの扱い（#229）。
 *
 * 利用者からの割り込みが無い5つの経路（要約・朝の見通し・お知らせの選定・話題・自宅の取り込み）が
 * 同じ関数を通る。文言は呼び出しごとの主語だけが違い、ログにそのまま出るので固定しておく。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { throwIfCodexFailed, type CodexResult } from "@/lib/codex";

const ok: CodexResult = {
  text: "本文",
  reply: "本文",
  messages: ["本文"],
  interrupted: false,
  errorMessage: null,
  usage: { inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0 },
};

describe("throwIfCodexFailed", () => {
  it("正常に終わった回は何も投げない", () => {
    assert.doesNotThrow(() => throwIfCodexFailed(ok, "朝の見通しの生成", 180_000));
  });

  it("打ち切られた回は、主語と秒数つきの文言で投げる", () => {
    assert.throws(
      () => throwIfCodexFailed({ ...ok, interrupted: true, usage: null }, "朝の見通しの生成", 180_000),
      { message: "朝の見通しの生成が180秒で返らなかった" },
    );
    assert.throws(
      () => throwIfCodexFailed({ ...ok, interrupted: true, usage: null }, "お知らせの選定", 60_000),
      { message: "お知らせの選定が60秒で返らなかった" },
    );
  });

  it("エラーで終わった回は、Codexの文言をそのまま投げる", () => {
    assert.throws(
      () => throwIfCodexFailed({ ...ok, errorMessage: "起動に失敗しました" }, "話題の仕入れ", 150_000),
      { message: "起動に失敗しました" },
    );
  });

  it("打ち切りとエラーが重なったら、打ち切りを先に扱う", () => {
    assert.throws(
      () => throwIfCodexFailed({ ...ok, interrupted: true, errorMessage: "x" }, "記録の要約", 120_000),
      { message: "記録の要約が120秒で返らなかった" },
    );
  });
});
