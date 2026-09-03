/**
 * 日付の鍵と見出し（#157）。**クライアントコンポーネントからimportする。**
 *
 * Prismaにも`next/headers`にも依存させない——記録の画面（`EntryList`）が日付の区切りを
 * 描くのに使うため。取り出し（DBを引く側）は `src/lib/day-log.ts` にある。
 *
 * 日付の境目は**日本時間**で決める（#79の `jstDateKey()`・#101の `jstParts()` と同じ理由）。
 * サーバーのタイムゾーンで切ると、UTCで動く環境では朝9時までがきのう扱いになる。
 * 同じ理由で、見出しの組み立てもサーバーとクライアントで同じ結果になる（`timeZone` を
 * 明示しているので、ブラウザのタイムゾーンに引きずられない）。
 */

/** 日付の鍵（`2026-09-03`）。日本時間で作る。 */
export function jstDayKey(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * `2026-09-03` の形かどうか。URLから来た値を通す前に必ず見る。
 *
 * **形だけを見て済ませない。** `2026-13-99` は正規表現を通るが `new Date()` は
 * Invalid Date を返し、そのまま `Intl` へ渡すとRangeErrorで500になる（実測）。
 * `2026-02-31` のように存在しない日も、ここで落とす。
 */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const at = dayStart(value);
  if (Number.isNaN(at.getTime())) return false;

  return jstDayKey(at) === value;
}

/** その日の始まり（日本時間の0時）をUTCの時刻として返す。 */
export function dayStart(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00+09:00`);
}

/** その日の終わり（翌日の0時）。 */
export function dayEnd(dayKey: string): Date {
  return new Date(dayStart(dayKey).getTime() + 86_400_000);
}

/** 月の見出し（`2026年9月`）。 */
export function monthLabel(dayKey: string): string {
  const [year, month] = dayKey.split("-");
  return `${year}年${Number(month)}月`;
}

/** 日付の見出し（`9月3日（木）`）。 */
export function dayLabel(dayKey: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(dayStart(dayKey));
}

/**
 * 左メニューとページの見出しに出す日付（`今日 9月3日（木）`）。
 *
 * 「今日」「きのう」を頭に足すだけで日付そのものは必ず出す。置き換えてしまうと、
 * 日付が変わった瞬間に同じ行の指す日がずれ、開いたままの画面で見分けが付かなくなる。
 */
export function dayHeading(dayKey: string, todayKey: string): string {
  const base = dayLabel(dayKey);
  if (dayKey === todayKey) return `今日 ${base}`;
  if (dayKey === jstDayKey(new Date(dayStart(todayKey).getTime() - 86_400_000))) return `きのう ${base}`;

  return base;
}

