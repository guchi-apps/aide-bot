import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TOPIC_CATEGORIES,
  TOPIC_LABEL_MAX,
  TOPIC_SCOPE_MAX,
  TOPIC_SHORT_MAX,
  initialTopicCategories,
  newTopicCategoryId,
  topicCategoryShort,
  validateTopicCategoryInput,
} from "../src/lib/topic-categories.ts";

test("初期の種類は移行元のオン・オフを引き継ぐ", () => {
  assert.deepEqual(initialTopicCategories("general,tech").map((c) => [c.id, c.enabled]), [
    ["general", true],
    ["life", false],
    ["tech", true],
  ]);
  // 空文字は「何も仕入れない」を尊重する。
  assert.ok(initialTopicCategories("").every((c) => !c.enabled));
  assert.equal(initialTopicCategories(null).length, DEFAULT_TOPIC_CATEGORIES.length);
  assert.ok(initialTopicCategories(null).every((c) => c.enabled));
});

test("入力の検証: 改行・空白を畳み、短い名前は名前の先頭から作る", () => {
  const result = validateTopicCategoryInput({ label: "  地元の\nできごと ", scope: "鉄道の\n運行情報\t全般", short: "" });
  assert.ok(result.ok);
  assert.equal(result.value.label, "地元の できごと");
  assert.equal(result.value.scope, "鉄道の 運行情報 全般");
  assert.equal(result.value.short, "地元の できごと");
});

test("入力の検証: 空・長すぎる・形の違う値は断る", () => {
  assert.equal(validateTopicCategoryInput(null).ok, false);
  assert.equal(validateTopicCategoryInput("x").ok, false);
  assert.equal(validateTopicCategoryInput({ label: "", scope: "a" }).ok, false);
  assert.equal(validateTopicCategoryInput({ label: "a", scope: "  " }).ok, false);
  assert.equal(validateTopicCategoryInput({ label: 1, scope: "a" }).ok, false);
  assert.equal(validateTopicCategoryInput({ label: "あ".repeat(TOPIC_LABEL_MAX + 1), scope: "a" }).ok, false);
  assert.equal(validateTopicCategoryInput({ label: "a", scope: "あ".repeat(TOPIC_SCOPE_MAX + 1) }).ok, false);
  assert.equal(validateTopicCategoryInput({ label: "a", scope: "a", short: "あ".repeat(TOPIC_SHORT_MAX + 1) }).ok, false);
  assert.ok(validateTopicCategoryInput({ label: "あ".repeat(TOPIC_LABEL_MAX), scope: "あ".repeat(TOPIC_SCOPE_MAX) }).ok);
});

test("新しい識別子はVarChar(20)に収まり、既定の3種類とは重ならない", () => {
  const id = newTopicCategoryId();
  assert.match(id, /^c_[a-z0-9]{12}$/);
  assert.ok(id.length <= 20);
  assert.ok(!DEFAULT_TOPIC_CATEGORIES.some((c) => c.id === id));
});

test("チップの名前: 削除された種類は「その他」", () => {
  const categories = initialTopicCategories(null);
  assert.equal(topicCategoryShort(categories, "life"), "暮らし");
  assert.equal(topicCategoryShort(categories, "c_deleted"), "その他");
});
