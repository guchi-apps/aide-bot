import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MODELS,
  DEFAULT_MODELS,
  MODEL_USES,
  MODEL_USE_META,
  mergeModelSettings,
  resolveModelSettings,
} from "@/lib/chat-model";

test("何も保存していなければ全用途が既定", () => {
  assert.deepEqual(resolveModelSettings(null), DEFAULT_MODELS);
  assert.deepEqual(resolveModelSettings(undefined), DEFAULT_MODELS);
});

test("知らない用途・モデル名・形は既定へ落とす", () => {
  assert.deepEqual(resolveModelSettings([]), DEFAULT_MODELS);
  assert.deepEqual(resolveModelSettings("gpt-6-sol"), DEFAULT_MODELS);
  const resolved = resolveModelSettings({ notice: "gpt-5.6-sol", topic: "nope", unknown: "gpt-6-sol", memory: "gpt-6-luna" });
  assert.equal(resolved.notice, DEFAULT_MODELS.notice);
  assert.equal(resolved.topic, DEFAULT_MODELS.topic);
  assert.equal(resolved.memory, "gpt-6-luna");
});

test("用途の表は3か所で揃っている", () => {
  for (const use of MODEL_USES) {
    assert.ok(MODEL_USE_META[use], use);
    assert.ok(CHAT_MODELS.some((model) => model.id === DEFAULT_MODELS[use]), use);
  }
});

test("既定と同じ値は保存に残さない", () => {
  const next = mergeModelSettings({ memory: "gpt-6-luna" }, { notice: "gpt-6-astra", topic: DEFAULT_MODELS.topic });
  assert.deepEqual(next, { memory: "gpt-6-luna", notice: "gpt-6-astra" });
  assert.deepEqual(mergeModelSettings(next, { memory: DEFAULT_MODELS.memory, notice: DEFAULT_MODELS.notice }), {});
});
