import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blocksDrawerSwipe,
  decideAxis,
  matchesOpenDirection,
  progressFor,
  shouldSettleOpen,
} from "../src/components/chat/swipe-drawer-rule.ts";

test("decideAxis: 動き始めは決めず、横が縦の1.5倍を超えたら横", () => {
  assert.equal(decideAxis(5, 3), "pending");
  assert.equal(decideAxis(20, 5), "horizontal");
  assert.equal(decideAxis(-20, 5), "horizontal");
  assert.equal(decideAxis(20, 20), "vertical");
  assert.equal(decideAxis(14, 10), "vertical");
  assert.equal(decideAxis(3, 30), "vertical");
});

test("progressFor: 0〜1に収まり、開いた状態からは左へ動くほど閉じる", () => {
  assert.equal(progressFor(false, 160, 320), 0.5);
  assert.equal(progressFor(false, 999, 320), 1);
  assert.equal(progressFor(false, -50, 320), 0);
  assert.equal(progressFor(true, -160, 320), 0.5);
  assert.equal(progressFor(true, 50, 320), 1);
  assert.equal(progressFor(false, 10, 0), 0);
});

test("shouldSettleOpen: 3分の1が境目、速い動きは向きに従う", () => {
  assert.equal(shouldSettleOpen(0.33, 0), false);
  assert.equal(shouldSettleOpen(0.34, 0), true);
  assert.equal(shouldSettleOpen(0.1, 0.5), true);
  assert.equal(shouldSettleOpen(0.9, -0.5), false);
  assert.equal(shouldSettleOpen(0.1, 0.39), false);
  // 開いた状態から始めた場合は、3分の1以上閉じ方向へ動かしたら閉じる
  assert.equal(shouldSettleOpen(0.67, 0, true), true);
  assert.equal(shouldSettleOpen(0.66, 0, true), false);
});

test("matchesOpenDirection: 閉じていれば右、開いていれば左だけ", () => {
  assert.equal(matchesOpenDirection(false, 12), true);
  assert.equal(matchesOpenDirection(false, -12), false);
  assert.equal(matchesOpenDirection(true, -12), true);
  assert.equal(matchesOpenDirection(true, 12), false);
});

test("blocksDrawerSwipe: 入力欄・スライダー・他の横スワイプ・横スクロールでは始めない", () => {
  assert.equal(blocksDrawerSwipe({ tagName: "INPUT" }), true); // type=range のスライダーを含む
  assert.equal(blocksDrawerSwipe({ tagName: "textarea" }), true);
  assert.equal(blocksDrawerSwipe({ tagName: "SELECT" }), true);
  assert.equal(blocksDrawerSwipe({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(blocksDrawerSwipe({ tagName: "DIV", ignoreMarked: true }), true);
  assert.equal(blocksDrawerSwipe({ tagName: "PRE", scrollsHorizontally: true }), true);
  assert.equal(blocksDrawerSwipe({ tagName: "DIV" }), false);
});
