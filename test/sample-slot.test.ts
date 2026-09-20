/**
 * 声の設定の「試し聞き」を、外から止めたときに持ち主へ知らせる約束（#279。自動レビューの指摘）。
 *
 * `Reader.cancel()` は `onStart` も `onDrain` も鳴らさない。持ち主のパネルは合成待ちの間ボタンを
 * 無効にしていて、下ろす手は `onDone` だけなので、止めても知らせないと「声を用意しています…」の
 * まま固まる。実際にリファクタリングでこの知らせが抜け、マイクを押した回・止めた回に固着した。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SampleSlot } from "@/lib/speech/sample-slot";

/** 止められた回数と、持ち主へ知らせた回数を数えるだけの偽物。 */
function fakeSample() {
  const counts = { cancelled: 0, done: 0 };
  return {
    counts,
    reader: {
      cancel: () => {
        counts.cancelled += 1;
      },
    },
    onDone: () => {
      counts.done += 1;
    },
  };
}

describe("SampleSlot", () => {
  it("止めると、読み上げを止めたうえで持ち主へ1回だけ知らせる", () => {
    const slot = new SampleSlot();
    const sample = fakeSample();

    slot.hold(sample.reader, sample.onDone);
    slot.cancel();

    assert.deepEqual(sample.counts, { cancelled: 1, done: 1 });
  });

  it("続けて止めても、2回目は何もしない", () => {
    const slot = new SampleSlot();
    const sample = fakeSample();

    slot.hold(sample.reader, sample.onDone);
    slot.cancel();
    slot.cancel();

    assert.deepEqual(sample.counts, { cancelled: 1, done: 1 });
  });

  it("読み終えて手放したものは、あとで止めても持ち主へもう一度知らせない", () => {
    const slot = new SampleSlot();
    const sample = fakeSample();

    slot.hold(sample.reader, sample.onDone);
    slot.release(sample.reader);
    slot.cancel();

    assert.deepEqual(sample.counts, { cancelled: 0, done: 0 });
  });

  it("次の試し聞きを置くと、前のぶんを止めて持ち主へ知らせる", () => {
    const slot = new SampleSlot();
    const first = fakeSample();
    const second = fakeSample();

    slot.hold(first.reader, first.onDone);
    slot.hold(second.reader, second.onDone);

    assert.deepEqual(first.counts, { cancelled: 1, done: 1 });
    assert.deepEqual(second.counts, { cancelled: 0, done: 0 });

    // 後から置いたものは、そのまま止められる。
    slot.cancel();
    assert.deepEqual(second.counts, { cancelled: 1, done: 1 });
  });

  it("前の試し聞きの読み終わりが遅れて届いても、後から置いたものを外さない", () => {
    const slot = new SampleSlot();
    const first = fakeSample();
    const second = fakeSample();

    slot.hold(first.reader, first.onDone);
    slot.hold(second.reader, second.onDone);
    slot.release(first.reader);
    slot.cancel();

    assert.deepEqual(second.counts, { cancelled: 1, done: 1 });
  });

  it("鳴っていなければ、止めても何も起きない", () => {
    const slot = new SampleSlot();

    assert.doesNotThrow(() => slot.cancel());
  });

  it("知らせる先が無くても、止められる", () => {
    const slot = new SampleSlot();
    const sample = fakeSample();

    slot.hold(sample.reader);

    assert.doesNotThrow(() => slot.cancel());
    assert.equal(sample.counts.cancelled, 1);
  });

  it("知らせた先が新しい試し聞きを始めても、止めたものと混ざらない", () => {
    const slot = new SampleSlot();
    const first = fakeSample();
    const second = fakeSample();

    // 持ち主は `onDone` の中で、すぐ次の試し聞きを置く（ボタンを押し直す動きに近い）。
    slot.hold(first.reader, () => {
      first.counts.done += 1;
      slot.hold(second.reader, second.onDone);
    });
    slot.cancel();

    assert.deepEqual(first.counts, { cancelled: 1, done: 1 });
    assert.deepEqual(second.counts, { cancelled: 0, done: 0 });

    slot.cancel();
    assert.deepEqual(second.counts, { cancelled: 1, done: 1 });
  });
});
