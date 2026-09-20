/**
 * 読み上げ速度を変えても声の高さが変わらないこと（#287）。
 *
 * `playbackRate` は早回しなので、速さと一緒に高さも変わっていた。伸縮の後で「長さが1/rateに
 * なる」と「基本周波数が変わらない」の両方を数値で確かめる。耳での確認の代わりにはならないが、
 * 高さが動く退行（`playbackRate` へ戻す・窓の送りを間違える）はここで捕まる。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { timeStretch } from "@/lib/speech/time-stretch";

const RATES = [0.7, 0.85, 1.3, 1.6];

/** 基本周波数 `f0` の倍音を重ねた、声のような波形。 */
function voiced(f0: number, sampleRate: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.round(sampleRate * seconds));
  for (let i = 0; i < samples.length; i += 1) {
    let value = 0;
    for (let harmonic = 1; harmonic <= 6; harmonic += 1) {
      value += Math.sin((2 * Math.PI * f0 * harmonic * i) / sampleRate) / harmonic;
    }
    samples[i] = value * 0.3;
  }
  return samples;
}

/** 自己相関のピークから基本周波数を推定する。中ほどの0.4秒だけを見る。 */
function estimateF0(samples: Float32Array, sampleRate: number): number {
  const from = Math.floor(samples.length * 0.3);
  const span = Math.min(Math.floor(sampleRate * 0.4), samples.length - from - 1);
  const minLag = Math.floor(sampleRate / 400);
  const maxLag = Math.floor(sampleRate / 80);

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = 0; i < span - maxLag; i += 1) score += samples[from + i] * samples[from + i + lag];
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  return sampleRate / bestLag;
}

function rms(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (to - from));
}

describe("timeStretch", () => {
  for (const sampleRate of [24000, 48000]) {
    for (const f0 of [120, 220]) {
      it(`${sampleRate}Hz・${f0}Hzの声: 速さを変えても高さは変わらず、長さは1/rateになる`, () => {
        const input = voiced(f0, sampleRate, 1.5);

        for (const rate of RATES) {
          const [output] = timeStretch([input], sampleRate, rate);

          const expected = input.length / rate;
          assert.ok(
            Math.abs(output.length - expected) <= 1,
            `rate=${rate}: 長さ ${output.length}（期待 ${Math.round(expected)}）`,
          );

          const estimated = estimateF0(output, sampleRate);
          assert.ok(
            Math.abs(estimated - f0) / f0 < 0.03,
            `rate=${rate}: 基本周波数 ${estimated.toFixed(1)}Hz（元 ${f0}Hz）`,
          );
        }
      });
    }
  }

  it("音量が保たれる（端で重みが足りなくても小さくならない）", () => {
    const input = voiced(150, 24000, 1.5);
    const before = rms(input, 0, input.length);

    for (const rate of RATES) {
      const [output] = timeStretch([input], 24000, rate);
      const after = rms(output, 0, output.length);
      assert.ok(Math.abs(after - before) / before < 0.1, `rate=${rate}: ${before} → ${after}`);
    }
  });

  it("rateが1ならそのまま返す", () => {
    const input = voiced(150, 24000, 0.2);
    const [output] = timeStretch([input], 24000, 1);
    assert.equal(output, input);
  });

  it("不正なrate・空の入力はそのまま返す", () => {
    const input = voiced(150, 24000, 0.2);
    for (const rate of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(timeStretch([input], 24000, rate)[0], input);
    }
    const empty = new Float32Array(0);
    assert.equal(timeStretch([empty], 24000, 1.5)[0], empty);
    assert.deepEqual(timeStretch([], 24000, 1.5), []);
  });

  it("無音は無音のまま（NaNや雑音を作らない）", () => {
    const [output] = timeStretch([new Float32Array(24000)], 24000, 1.4);
    assert.ok(output.every((value) => value === 0));
  });

  it("窓より短い入力でも落ちず、長さが1/rateに近い", () => {
    const input = voiced(200, 24000, 0.01);
    for (const rate of RATES) {
      const [output] = timeStretch([input], 24000, rate);
      assert.ok(output.length >= 1);
      assert.ok(output.every((value) => Number.isFinite(value)));
      assert.ok(Math.abs(output.length - input.length / rate) <= 1);
    }
  });

  it("チャンネルの継ぎ目は共通で、同じ波形の2チャンネルは同じ結果になる", () => {
    const input = voiced(150, 24000, 0.5);
    const [left, right] = timeStretch([input, Float32Array.from(input)], 24000, 1.3);
    assert.deepEqual(left, right);
  });
});
