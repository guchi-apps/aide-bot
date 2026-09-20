/**
 * 鳴っている「試し聞き」を1つだけ持つ入れ物（#279）。
 *
 * **`Reader.cancel()` は `onStart` も `onDrain` も鳴らさない**（止めたのは利用者のため）。ところが
 * 試し聞きの持ち主（声の設定のパネル）は、合成待ちの間「声を用意しています…」を出してボタンを
 * 無効にしており、下ろす手は `onDone`（鳴り始めた・読み終えた）だけ。外から止められたときに
 * 持ち主へ知らせないと、パネルを閉じて開き直すまで押せないまま固まる。
 *
 * リファクタリング前は、止める側（`VoicePanel`）が持ち主の状態を直接下ろしていた。持ち主を別の
 * 部品へ切り出したことでその手が届かなくなり、自動レビューが指摘した退行になった。
 * **止めるときに持ち主へ知らせる約束をここに閉じて、テストで固める**（`test/sample-slot.test.ts`）。
 *
 * このモジュールは `speechSynthesis` にも `window` にも触れない。`./synthesis` は素のNodeでは
 * 読めない（パラメータプロパティを型剥がしできない）ので、契約だけを切り出してある。
 */

/** 止められるもの。`Reader`（`./synthesis`）がこれを満たす。 */
export type Cancellable = { cancel: () => void };

type Sample = { reader: Cancellable; onDone: (() => void) | undefined };

export class SampleSlot {
  private current: Sample | null = null;

  /**
   * 新しい試し聞きを置く。**前のぶんが残っていれば、先に止めて持ち主へ知らせる。**
   * 重ねて鳴らすと、どちらの声を聞いているのか分からない。
   *
   * `onDone` は持ち主へ「もう鳴らさない」と知らせる手。**読み終えたときは `release()` を呼ぶ**
   * ——残すと、あとの `cancel()` が終わったものへ `onDone` をもう一度呼ぶ。
   */
  hold(reader: Cancellable, onDone?: () => void): void {
    this.cancel();
    this.current = { reader, onDone };
  }

  /**
   * 読み終えた（または失敗して終わった）ものを手放す。止めはしない。
   *
   * **手放すのは `reader` が現役のときだけ。** 前の試し聞きの読み終わりが遅れて届いたとき、
   * 後から置いたものまで外してしまわない。
   */
  release(reader: Cancellable): void {
    if (this.current?.reader === reader) this.current = null;
  }

  /**
   * 鳴っているものを止め、持ち主へ知らせる。鳴っていなければ何もしない。
   *
   * 順序は「止める→知らせる」。知らせた先が新しい試し聞きを始めても、止めたものと混ざらない。
   */
  cancel(): void {
    const sample = this.current;
    this.current = null;
    if (!sample) return;

    sample.reader.cancel();
    sample.onDone?.();
  }
}
