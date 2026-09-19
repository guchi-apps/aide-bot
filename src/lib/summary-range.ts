/**
 * 日を消したとき、要約へ畳んだ範囲から何件が抜けるか（#157・#245・#265）。
 * **Prismaを持ち込まない純粋な関数だけ**（単体テストから読めるように、`day-log.ts` から切り出してある）。
 *
 * 畳んだ範囲は「いちばん古い `summarizedCount` 件」で、日付の範囲も時刻で連続している。
 * したがって、消す日より前にある発言の数（`olderCount`）を引けば、消すぶん（`dayCount`）の
 * うち何件が畳んだ範囲に入っていたかがそのまま出る。
 *
 * **ここがずれると静かに壊れる。** 多く引けば畳んでいない発言まで要約済みとして扱われて
 * 読み飛ばされ、少なく引けば畳んだ範囲が先へ食い込んで、要約にも履歴にも入らない発言ができる。
 */
export function removedFromSummary(summarizedCount: number, olderCount: number, dayCount: number): number {
  return Math.max(0, Math.min(summarizedCount - olderCount, dayCount));
}
