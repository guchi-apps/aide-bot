import assert from "node:assert/strict";
import test from "node:test";

import { checkConsistency } from "../ios/scripts/check-consistency.mjs";

test("iOSアプリ（Swift）とサーバー（TS）で、戻り先スキーム・横取りするパス・同一オリジン判定・エフェメラルが揃っている", () => {
  assert.deepEqual(checkConsistency(), []);
});
