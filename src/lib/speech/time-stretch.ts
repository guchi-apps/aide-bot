/**
 * 声の高さを保ったまま、音声の長さだけを変える（#287。WSOLA）。
 *
 * VOICEVOXの読み上げは、合成した音声を Web Audio で鳴らしている。`playbackRate` を変えると
 * 再生を早回し・遅回しするだけなので、速さと一緒に**声の高さも上下する**（1.6倍なら約8半音高い）。
 * `<audio>` の `preservesPitch` は#210で避けた `<audio>` 再生に戻ることになり、WEB版の合成API
 * （`api.tts.quest`）はキー無しだと `speed` / `pitch` を受け付けない（#287で実測）。
 * 合成の側では変えられないので、デコードした波形をこちらで伸縮する。
 *
 * 短い窓（30ms）を、入力側では `rate` 倍の間隔・出力側では等間隔で取り出して重ねて足す。
 * 窓を素直な位置で切ると継ぎ目で波形の位相がずれて音が濁るので、前の窓の続きに一番似ている位置を
 * 前後に少し探して、そこから切る。
 *
 * **DOM・Web Audioに触れない純粋関数にしてある。** クライアントからだけでなく、テストからも
 * 素のNodeで読める形を保つこと（`test/time-stretch.test.ts`）。
 */

/** 窓の長さ（秒）。声の基本周期（男声で約10ms）を2周期以上含む長さ。 */
const WINDOW_SECONDS = 0.03;

/** 継ぎ目を探す前後の幅（秒）。 */
const SEEK_SECONDS = 0.008;

/**
 * 継ぎ目を探すときに相関を数える標本の細かさ（Hz）。
 *
 * 合成の標本化周波数（24kHz。`AudioContext` へデコードすると48kHzなどに上がる）のままだと、
 * 探索が窓×幅の掛け算で重い。声の高さの手掛かりは数kHz以下なので、間引いても位置は変わらない。
 */
const CORRELATION_RATE = 8000;

/** 窓の掛かり具合（ハン窓）。半分ずつ重ねると足して1になる。 */
function hannWindow(length: number): Float32Array {
  const window = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length);
  }
  return window;
}

/**
 * 直前に採った窓の続き（`reference`）に一番似た窓の開始位置を、`nominal` の前後から探す。
 *
 * 近い位置を先に見て、厳密に大きいときだけ更新する。無音のように差が付かない区間では
 * 動かさずに `nominal` のままにするため。
 */
function bestStart(
  samples: Float32Array,
  reference: number,
  nominal: number,
  seek: number,
  windowLength: number,
  stride: number,
): number {
  const length = samples.length;
  let best = Math.min(Math.max(nominal, 0), length - 1);
  let bestScore = -Infinity;

  for (let step = 0; step <= 2 * seek; step += 1) {
    // 0, +1, -1, +2, -2, ... の順。
    const offset = step % 2 === 1 ? (step + 1) / 2 : -step / 2;
    const start = nominal + offset;
    if (start < 0 || start >= length) continue;

    const count = Math.min(windowLength, length - start, length - reference);
    let dot = 0;
    let energy = 0;
    for (let i = 0; i < count; i += stride) {
      const candidate = samples[start + i];
      dot += candidate * samples[reference + i];
      energy += candidate * candidate;
    }

    // 大きい音ほど有利にならないよう、候補の大きさで割った相関で比べる。
    const score = dot / Math.sqrt(energy + 1e-9);
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }

  return best;
}

/**
 * 声の高さを保ったまま、長さを `1 / rate` にする。`rate` が1より大きければ速く、小さければ遅く。
 *
 * `channels` はチャンネルごとの波形。継ぎ目の位置は1チャンネル目で決めて全チャンネルへ同じに
 * 当てる（別々に決めると、チャンネルの間で位相がずれる）。`rate` が1（または不正な値）なら
 * 入力をそのまま返す。
 */
export function timeStretch(
  channels: Float32Array[],
  sampleRate: number,
  rate: number,
): Float32Array[] {
  const length = channels[0]?.length ?? 0;
  if (length === 0 || !Number.isFinite(rate) || rate <= 0 || rate === 1) return channels;

  // 窓の送りが整数になるよう、窓の長さは偶数にする。
  const windowLength = Math.max(2, Math.round((WINDOW_SECONDS * sampleRate) / 2) * 2);
  const hop = windowLength / 2;
  const seek = Math.max(1, Math.round(SEEK_SECONDS * sampleRate));
  const stride = Math.max(1, Math.floor(sampleRate / CORRELATION_RATE));
  const outLength = Math.max(1, Math.round(length / rate));

  const window = hannWindow(windowLength);
  const outputs = channels.map(() => new Float32Array(outLength));
  const weights = new Float32Array(outLength);

  let previous = 0;
  for (let frame = 0, outStart = 0; outStart < outLength; frame += 1, outStart += hop) {
    const start =
      frame === 0
        ? 0
        : bestStart(
            channels[0],
            // 直前の窓が、そのまま続いていたら次に来るはずの位置。
            previous + hop,
            Math.round(frame * hop * rate),
            seek,
            windowLength,
            stride,
          );

    const count = Math.min(windowLength, outLength - outStart);
    for (let i = 0; i < count; i += 1) weights[outStart + i] += window[i];

    channels.forEach((samples, index) => {
      const output = outputs[index];
      // 入力の終わりを越えたぶんは無音として足す。
      const available = Math.min(count, Math.max(0, length - start));
      for (let i = 0; i < available; i += 1) output[outStart + i] += samples[start + i] * window[i];
    });

    previous = start;
  }

  // 端では窓が重ならず、重みが1に届かない。重みで割って音量を揃える。
  for (const output of outputs) {
    for (let i = 0; i < outLength; i += 1) {
      if (weights[i] > 1e-9) output[i] /= weights[i];
    }
  }

  return outputs;
}
