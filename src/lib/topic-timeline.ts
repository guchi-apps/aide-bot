/**
 * 話題の画面の時系列（#418）。**Prismaに触れない純粋な関数だけ**（境目は `test/topic-timeline.test.ts` が固定する）。
 *
 * 並びと「取り込み回」の区切りは `createdAt`（初めて取り込んだ時刻）で作る。`fetchedAt` は仕入れ直しで
 * 進むので、見ていない回の区切りに既読の記事が混ざり、「ここまで未読」の線が1本で引けなくなる。
 * 未読は `createdAt > seenAt`。時刻順に並べるので、未読は必ず先頭側に固まる。
 */

/** 隣り合う記事の取り込み時刻がこの間隔以内なら、同じ回の仕入れとみなす（行ごとのinsertでずれるぶん。仕入れは最短30分間隔）。 */
export const BATCH_GAP_MS = 2 * 60 * 1000;

export type TimelineRowInput = { id: string; createdAt: Date };

export type TimelineEntry<T extends TimelineRowInput> =
  /** 取り込み回の見出し。`startedAt` はその回でいちばん古い取り込み時刻、`count` はその回の件数。 */
  | { kind: "batch"; key: string; startedAt: Date; count: number }
  | { kind: "row"; key: string; row: T; unread: boolean }
  /** 「ここまで未読」の線。直前が未読で、直後が既読のときだけ入る。 */
  | { kind: "seen"; key: string };

/** 新しい順（同時刻は `id` で固定）に並べ、回の見出しと未読の境目を差し込んだ平らな列にする。 */
export function buildTimeline<T extends TimelineRowInput>(rows: readonly T[], seenAt: Date | null): TimelineEntry<T>[] {
  const sorted = [...rows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  // 回の切り分け。新しい順に見て、前の記事との差が間隔を超えたところで新しい回にする。
  const batches: T[][] = [];
  for (const row of sorted) {
    const current = batches[batches.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && previous.createdAt.getTime() - row.createdAt.getTime() <= BATCH_GAP_MS) {
      current.push(row);
    } else {
      batches.push([row]);
    }
  }

  const isUnread = (row: T) => seenAt !== null && row.createdAt.getTime() > seenAt.getTime();
  const entries: TimelineEntry<T>[] = [];
  let previousUnread = false;
  for (const batch of batches) {
    // 境目が回と回のあいだなら、次の回の見出しより前に線を置く（線が前の回の終わりに付くように）。
    if (previousUnread && !isUnread(batch[0])) entries.push({ kind: "seen", key: `seen-${batch[0].id}` });
    const oldest = batch[batch.length - 1];
    entries.push({ kind: "batch", key: `batch-${oldest.id}`, startedAt: oldest.createdAt, count: batch.length });
    for (const row of batch) {
      const unread = isUnread(row);
      if (previousUnread && !unread && row !== batch[0]) entries.push({ kind: "seen", key: `seen-${row.id}` });
      entries.push({ kind: "row", key: row.id, row, unread });
      previousUnread = unread;
    }
  }
  return entries;
}

/** 未読（新着）の件数。 */
export function unreadCount(rows: readonly TimelineRowInput[], seenAt: Date | null): number {
  if (seenAt === null) return 0;
  return rows.filter((row) => row.createdAt.getTime() > seenAt.getTime()).length;
}
