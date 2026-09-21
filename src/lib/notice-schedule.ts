import { NoticePriority } from "@prisma/client";

/**
 * お知らせ選定を「いま呼び直すか」の判定（#93・#227）。
 *
 * `notices.ts` から切り出してある。あちらはPrismaとCodexに触れるので、単体テストからは読めない
 * （`test/notice-schedule.test.ts` がここだけを読む）。**Prismaのクライアントを実行時に使わない**
 * こと——`NoticePriority` のような生成物の列挙型のimportだけなら素のNodeでも読める。
 *
 * ## なぜ「候補が変わっていなければ呼ばない」のか
 *
 * 以前は、未読の候補が1件でも残っていれば、モデルが黙った（`NO_NOTICE`）後でも10分ごとに選び直して
 * いた。同じ候補を同じ基準で見せ直しても答えは変わらないのに、1回あたり約12,600トークン（Codexの
 * 前置きぶんを含む。#132の実測）を使い、「話す」画面を開いている間は1時間に最大6回走る。
 *
 * ## 呼び直す条件（黙った回の後だけ絞る）
 *
 * 前回が**黙った回**（`silent`）のときだけ、次のどれかが起きるまで呼ばない。
 *
 * - 前回の候補に入っていなかったお知らせが増えた（積まれた・`showAt` が来た）
 * - 前回から `NOTICE_REFRESH_MS`（60分）経った
 * - 時間帯（朝・昼・夕方…）が変わった
 * - 期限（`expiresAt`）が迫った候補がある（「あと約N分で意味が無くなります」は候補の一覧に
 *   載り、選ぶ理由になる。しきい値を1つ越えるたびに1回だけ見直す）
 *
 * **前回が何かを選んだ回のときは絞らない**（従来どおり10分おき）。選ばれなかった残りが順番待ちを
 * しているだけで、「黙った」とは違い、まだ一度も見せていないため。その回に選ばれたものは
 * `shownAt` が入って候補から外れるので、残りの選び直しは次の回に進む——黙った回に当たった時点で
 * 止まる。
 *
 * **候補が減っただけ（期限切れ・出し終えた）では呼び直さない。** 減った側は前回すべて見せて
 * 黙られているので、残りだけで問い直しても結果は変わらない。
 *
 * 急ぎ（`URGENT`）の割り込み（`NOTICE_URGENT_INTERVAL_MS`）はこの絞り込みの外にあり、
 * 前回の候補に入っていない急ぎが積まれた回は従来どおり1分で選び直す。
 */

/** 選び直す間隔。画面を開いている間、これより短い間隔ではモデルを呼ばない。 */
export const NOTICE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 急ぎが届いたときに、選び直しまで最低限あける間隔。
 *
 * 「急ぎならすぐに」を素直に書くと、急ぎが立て続けに積まれた回に何度も生成が走る。
 * まだ一度も候補に入れていない急ぎがあることを条件にしたうえで、さらにこの間隔で床を張る。
 */
export const NOTICE_URGENT_INTERVAL_MS = 60 * 1000;

/**
 * 候補が変わっていなくても選び直す間隔（#227）。
 *
 * 黙った回の後に、時間の経過だけで価値が変わるもの（期限・時間帯の変化はそれぞれ別に見ている）
 * 以外の取りこぼしを拾う保険。**これより短くすると節約の意味が薄れ、長くすると
 * 「積んだのにずっと黙っている」が長引く。**
 */
export const NOTICE_REFRESH_MS = 60 * 60 * 1000;

/**
 * 期限が迫ったとみなす残り時間（分）。大きい方から並べる。
 *
 * 候補の一覧には「あと約N分で意味が無くなります」が載り、モデルが選ぶ手掛かりになる。60分前で
 * 黙られたものも、15分前になれば選ばれるかもしれない。**しきい値を1つ越えるたびに1回だけ**
 * 呼び直す（残りが60分以内の間ずっと10分おきに呼ぶ形にはしない）。
 */
const EXPIRY_THRESHOLDS_MINUTES = [60, 15] as const;

/** 判定に使う候補の項目。`Notice` のうち、ここで見るものだけ。 */
export type ScheduleCandidate = {
  id: string;
  priority: NoticePriority;
  expiresAt: Date | null;
};

/** 直近の生成の記録。プロセス内にだけ持つ（`notices.ts` の `lastRuns`）。 */
export type LastRun = {
  at: number;
  /** その回に候補として渡したお知らせのID。 */
  consideredIds: Set<string>;
  /** 何も選ばなかった回（`NOTICE_SKIP_TOKEN` か、読めない形の返答）。 */
  silent: boolean;
  /** その回の時間帯。 */
  slot: string;
  /** その回に候補ごとに見た、期限の迫り具合（`expiryBand()`）。 */
  expiryBands: Map<string, number>;
};

/**
 * 期限の迫り具合。0＝期限なしか60分より先、1＝60分以内、2＝15分以内。
 * 期限を過ぎた候補はそもそも候補に入らない（`pendingNoticeWhere`）ので扱わない。
 */
export function expiryBand(expiresAt: Date | null, now: Date): number {
  if (!expiresAt) return 0;
  const minutes = (expiresAt.getTime() - now.getTime()) / 60000;
  return EXPIRY_THRESHOLDS_MINUTES.filter((threshold) => minutes <= threshold).length;
}

/**
 * 時間帯。日本時間で決める（サーバーのタイムゾーンに頼らない。#79の `jstDayKey()` と同じ理由）。
 * 区切りは `chatter.ts` の `timeSlot()` と同じ——待機中の吹き出しが「おはようございます」から
 * 「お昼どきですね」へ替わるのと同じ境目で、選ぶ側も見直す。
 */
export function noticeSlot(now: Date): string {
  const hour =
    Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", hour: "2-digit", hour12: false })
        .formatToParts(now)
        .find((part) => part.type === "hour")?.value ?? "0",
    ) % 24;

  if (hour < 5) return "late";
  if (hour < 11) return "morning";
  if (hour < 15) return "noon";
  if (hour < 19) return "evening";
  if (hour < 23) return "night";
  return "late";
}

/** 選び終えた回の記録を作る。 */
export function recordRun(candidates: ScheduleCandidate[], now: Date, silent: boolean): LastRun {
  return {
    at: now.getTime(),
    consideredIds: new Set(candidates.map((notice) => notice.id)),
    silent,
    slot: noticeSlot(now),
    expiryBands: new Map(candidates.map((notice) => [notice.id, expiryBand(notice.expiresAt, now)])),
  };
}

/**
 * 生成を走らせてよいか。
 *
 * 通常は `NOTICE_INTERVAL_MS` に1回まで。ただし**まだ一度も候補に入れていない急ぎ**が
 * 積まれているときは、`NOTICE_URGENT_INTERVAL_MS` まで詰めて先に出す（「急ぎならすぐに」）。
 * 前回が黙った回なら、さらに上の「呼び直す条件」のどれかを満たす回だけ通す（#227）。
 */
export function shouldGenerate(
  last: LastRun | undefined,
  pending: ScheduleCandidate[],
  now: Date,
): boolean {
  if (pending.length === 0) return false;
  if (!last) return true;

  const elapsed = now.getTime() - last.at;

  const freshUrgent = pending.some(
    (notice) => notice.priority === NoticePriority.URGENT && !last.consideredIds.has(notice.id),
  );
  if (freshUrgent && elapsed >= NOTICE_URGENT_INTERVAL_MS) return true;

  if (elapsed < NOTICE_INTERVAL_MS) return false;

  // 前回は選んだ。選ばれなかった残りが順番待ちをしているだけなので、従来どおり10分おきに進める。
  if (!last.silent) return true;

  if (elapsed >= NOTICE_REFRESH_MS) return true;
  if (noticeSlot(now) !== last.slot) return true;

  return pending.some(
    (notice) =>
      !last.consideredIds.has(notice.id) ||
      expiryBand(notice.expiresAt, now) > (last.expiryBands.get(notice.id) ?? 0),
  );
}
