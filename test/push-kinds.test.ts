import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PUSH_KINDS,
  PUSH_KIND_INFO,
  isPushKind,
  parseDisabledKinds,
  serializeDisabledKinds,
} from "../src/lib/push/kinds.ts";

test("空・nullは全部オン", () => {
  assert.equal(parseDisabledKinds("").size, 0);
  assert.equal(parseDisabledKinds(null).size, 0);
});

test("知らない種類・空白は捨てる", () => {
  const set = parseDisabledKinds(" morning-briefing ,unknown,,scheduled-push");
  assert.deepEqual([...set].sort(), ["morning-briefing", "scheduled-push"]);
});

test("保存は決まった順で、読み戻すと同じ集合になる", () => {
  const set = parseDisabledKinds("scheduled-push,morning-briefing");
  const stored = serializeDisabledKinds(set);
  assert.equal(stored, "morning-briefing,scheduled-push");
  assert.deepEqual(parseDisabledKinds(stored), set);
});

test("全部オフにしても列（200文字）に収まる", () => {
  assert.ok(serializeDisabledKinds(new Set(PUSH_KINDS)).length <= 200);
});

test("全種類に見本があり、遷移先は内部パス", () => {
  for (const kind of PUSH_KINDS) {
    assert.ok(isPushKind(kind));
    const { sample } = PUSH_KIND_INFO[kind];
    assert.ok(sample.title && sample.body);
    assert.match(sample.url, /^\/(?!\/)/);
  }
  assert.equal(isPushKind("nope"), false);
});
