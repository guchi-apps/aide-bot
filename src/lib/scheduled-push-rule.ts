import { dayStart, jstDayKey } from "@/lib/day-key";

/**
 * 定時のお知らせ（#344）の判定。**Prismaに触れない純粋な関数だけ**（クライアントの設定カードからも
 * importするので、DBを持ち込まない。境目は `test/scheduled-push-rule.test.ts` が固定する）。
 */

export const SCHEDULED_PUSH_KIND = "scheduled-push";

/** 曜日。ビットの位置は `Date#getDay()` と同じ（日曜=0）。 */
export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export const ALL_DAYS_MASK = 0b1111111;

/** 1人が登録できる件数。増やしすぎると毎日の通知が読まれなくなる（#79）。 */
export const SCHEDULED_PUSH_LIMIT = 8;

/** 予定の時刻を過ぎていても送ってよい猶予。停止・遅延後に夜中まで古い時刻の通知を送らない。 */
export const LATE_LIMIT_MINUTES = 3 * 60;

/** 通知に載せる話題の最大件数。 */
export const SCHEDULED_PUSH_TOPIC_LIMIT = 3;

/**
 * 種類を問わず届けるときの `category` の値。それ以外は利用者の話題の種類（`TopicCategory.key`。#345）で、
 * 種類が追加・削除できるので**ここでは形を決めない**——受け付けるときに利用者の種類と突き合わせる。
 */
export const SCHEDULED_PUSH_ALL = "all";

/** 曜日の配列（0〜6）をビット列へ。範囲外・重複は落とす。 */
export function daysToMask(days: readonly number[]): number {
  let mask = 0;
  for (const day of days) {
    if (Number.isInteger(day) && day >= 0 && day <= 6) mask |= 1 << day;
  }
  return mask;
}

export function maskToDays(mask: number): number[] {
  return WEEKDAYS.map((_, day) => day).filter((day) => (mask & (1 << day)) !== 0);
}

/** 日本時間の曜日（日曜=0）。サーバーのタイムゾーンに頼らない。 */
export function jstWeekday(at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(at);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

/** 日本時間の「その日の何分目か」（0〜1439）。 */
export function jstMinuteOfDayAt(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return value("hour") * 60 + value("minute");
}

export type ScheduleLike = { daysMask: number; hour: number; minute: number; createdAt: Date };

/**
 * いま送る時間か。今日の曜日が対象で、予定の時刻を過ぎており、猶予（3時間）内であること。
 *
 * **登録した時刻より前に決まっていた予定の時刻には送らない**——登録した直後に「今日の分」が
 * 過去の時刻として発火して驚かせない。
 */
export function isDue(schedule: ScheduleLike, now: Date): boolean {
  if ((schedule.daysMask & (1 << jstWeekday(now))) === 0) return false;

  const scheduled = schedule.hour * 60 + schedule.minute;
  const current = jstMinuteOfDayAt(now);
  if (current < scheduled || current - scheduled > LATE_LIMIT_MINUTES) return false;

  const scheduledAt = dayStart(jstDayKey(now)).getTime() + scheduled * 60_000;
  return schedule.createdAt.getTime() <= scheduledAt;
}

/** 同じ日・同じ設定で二度送らないための鍵（`NotificationLog` の一意制約）。 */
export function scheduledDedupeKey(scheduleId: string, now: Date): string {
  return `${jstDayKey(now)}:${scheduleId}`;
}

/** 通知の本文。話題の見出しを1行ずつ。 */
export function composeScheduledBody(titles: readonly string[]): string {
  return titles.slice(0, SCHEDULED_PUSH_TOPIC_LIMIT).map((title) => `・${title}`).join("\n");
}
