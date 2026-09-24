import assert from "node:assert/strict";
import { test } from "node:test";
import { secretarySystemPrompt, suggestionRules } from "../src/lib/anthropic.ts";

const joined = (n: boolean, a: boolean) => suggestionRules({ notion: n, aide: a }).join("\n");

test("Notion未接続では設定の接続へ案内し、希望リストは読ませない", () => {
  const text = joined(false, true);
  assert.match(text, /接続からNotionを追加/);
  assert.doesNotMatch(text, /やってみたい/);
});

test("両方接続なら候補の条件・除外・書き込み禁止を含む", () => {
  const text = joined(true, true);
  assert.match(text, /やってみたい/);
  assert.match(text, /達成」「見送り」は通常の提案に出さない/);
  assert.match(text, /aide_schedule/);
  assert.match(text, /書き込まない/);
  assert.match(text, /候補が無いとは言わない/);
});

test("AIDE未接続なら空き時間を確かめられないと伝えさせる", () => {
  const text = joined(true, false);
  assert.doesNotMatch(text, /aide_schedule で取る/);
  assert.match(text, /空いていると決めつけない/);
});

test("システムプロンプトに組み込まれる", () => {
  const prompt = secretarySystemPrompt("text", [], false, [], new Date(), { notion: true, aide: true });
  assert.match(prompt, /いつかやりたいこと/);
});
