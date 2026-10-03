import assert from "node:assert/strict";
import test from "node:test";

import { isKeyboardOpen, shouldApplyVisualViewport } from "@/components/chat/use-visual-viewport";

test("キーボードとみなすのは120pxを超えて表示領域が縮んだときだけ", () => {
  assert.equal(isKeyboardOpen(800, 680), false);
  assert.equal(isKeyboardOpen(800, 679), true);
});

test("入力欄にフォーカスしている間は60pxを超える縮みでキーボードとみなす（#476）", () => {
  assert.equal(isKeyboardOpen(800, 740, true), false);
  assert.equal(isKeyboardOpen(800, 739, true), true);
  assert.equal(isKeyboardOpen(800, 739, false), false);
});

test("指で拡大している間はVisual Viewportの高さを画面キーボードとして扱わない", () => {
  assert.equal(shouldApplyVisualViewport(1), true);
  assert.equal(shouldApplyVisualViewport(1.009), true);
  assert.equal(shouldApplyVisualViewport(1.02), false);
});
