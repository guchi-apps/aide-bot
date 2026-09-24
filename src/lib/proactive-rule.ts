import { createHash } from "node:crypto";

import { jstDayKey } from "@/lib/day-key";
import {
  type ProactiveFrequency,
  type ProactiveKind,
  type ProactiveSettings,
} from "@/lib/proactive-labels";

export { normalizeFrequency } from "@/lib/proactive-labels";

/**
 * 先回りの提案（#325）の判定。**Prismaもcodexも持ち込まない純粋な関数だけ。**
 *
 * 提案の1回はCodex＋MCP（Notion・AIDE）を通るので朝の見通しと同じくらい重い。**モデルを呼ぶ前に、
 * DBの値だけで決まるこの判定で必ず弾く**——静音・勤務帯・種類オフ・上限・間隔のどれかに当たれば、
 * 呼ばずに戻る。境目は `test/proactive-rule.test.ts` が固定する。
 */

/** 通知の種類。`NotificationLog.kind` に入る。朝の見通し・急ぎのお知らせとは抑制の単位を分ける。 */
export const PROACTIVE_NOTIFICATION_KIND = "proactive-suggestion";

/** 「提案するものは無い」と返させる合図。取得に失敗した回もこれで黙る。 */
export const PROACTIVE_SKIP_TOKEN = "NO_SUGGESTION";

/** 判定を試みる間隔。送った・黙った・失敗のどれでも空ける。 */
export const PROACTIVE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** 平日の勤務・通勤の時間帯（日本時間）。祝日は分からないので曜日だけで決める。 */
export const WORK_START_MINUTE = 8 * 60;
export const WORK_END_MINUTE = 19 * 60;

/** 週末の提案を考える曜日（金曜の勤務後・土曜）。0=日〜6=土。 */
const WEEKEND_ELIGIBLE_WEEKDAYS: readonly number[] = [5, 6];

/** 日本時間の曜日（0=日〜6=土）と、その日の何分目か。サーバーのタイムゾーンに頼らない。 */
export function jstWeekdayAndMinute(at: Date): { weekday: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));

  return { weekday, minute: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/** 週の鍵。その週の月曜（日本時間）の日付。週の上限と同じ週末の重複抑制に使う。 */
export function jstWeekKey(at: Date): string {
  const { weekday } = jstWeekdayAndMinute(at);
  const sinceMonday = (weekday + 6) % 7;

  return jstDayKey(new Date(at.getTime() - sinceMonday * 86_400_000));
}

/** 静かな時間帯か。日をまたぐ設定（22時〜8時）を扱い、開始と終了が同じなら設けない。 */
export function isQuietMinute(minute: number, startHour: number, endHour: number): boolean {
  const start = startHour * 60;
  const end = endHour * 60;

  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;

  return minute >= start || minute < end;
}

/** 平日の勤務・通勤の時間帯か。 */
export function isWorkTime(weekday: number, minute: number): boolean {
  if (weekday === 0 || weekday === 6) return false;

  return minute >= WORK_START_MINUTE && minute < WORK_END_MINUTE;
}

/** 頻度ごとの上限。`perDay` は常に1（通常の提案は原則1日1件まで）。 */
export function frequencyLimits(frequency: ProactiveFrequency): { perDay: number; perWeek: number } {
  switch (frequency) {
    case "twice_weekly":
      return { perDay: 1, perWeek: 2 };
    case "weekly":
      return { perDay: 1, perWeek: 1 };
    default:
      return { perDay: 1, perWeek: 7 };
  }
}

export type ProactiveGate =
  | { run: true; kinds: ProactiveKind[] }
  | { run: false; reason: string };

/**
 * いまモデルを呼んで提案を探してよいか。
 *
 * **判定の順は安いものから。** どれも引数の値だけで決まり、DBもモデルも触らない。
 */
export function proactiveGate(params: {
  now: Date;
  settings: ProactiveSettings;
  /** 今日すでに送った提案の件数（日本時間の日付で数える）。 */
  sentToday: number;
  /** 今週（月曜始まり）にすでに送った提案の件数。 */
  sentThisWeek: number;
  lastCheckedAt: Date | null;
}): ProactiveGate {
  const { now, settings, sentToday, sentThisWeek, lastCheckedAt } = params;

  const { weekday, minute } = jstWeekdayAndMinute(now);
  const weekendEligible = WEEKEND_ELIGIBLE_WEEKDAYS.includes(weekday);

  const kinds: ProactiveKind[] = [];
  if (settings.weekend && weekendEligible) kinds.push("weekend");
  if (settings.freeTime) kinds.push("free_time");
  if (settings.ongoing) kinds.push("ongoing");
  if (kinds.length === 0) return { run: false, reason: "対象の種類が無い" };

  if (isQuietMinute(minute, settings.quietStart, settings.quietEnd)) {
    return { run: false, reason: "静かな時間帯" };
  }

  if (settings.avoidWork && isWorkTime(weekday, minute)) {
    return { run: false, reason: "勤務・通勤の時間帯" };
  }

  const limits = frequencyLimits(settings.frequency);
  if (sentToday >= limits.perDay) return { run: false, reason: "今日の上限" };
  if (sentThisWeek >= limits.perWeek) return { run: false, reason: "今週の上限" };

  if (lastCheckedAt && now.getTime() - lastCheckedAt.getTime() < PROACTIVE_CHECK_INTERVAL_MS) {
    return { run: false, reason: "前回の判定から間もない" };
  }

  return { run: true, kinds };
}

export type ProactiveSuggestion = {
  kind: ProactiveKind;
  /** 候補の名前（Notionの項目名・タスク名・空き時間の日付）。整形済み。 */
  candidate: string;
  /** 予定の状態の指紋（空き時間の日時など）。整形済み。 */
  fingerprint: string;
  text: string;
};

/** 鍵に使う文字列を整える。区切り（`|`・`:`）と空白は `_` に、長さは40文字までにする。 */
function sanitizeKeyPart(value: string): string {
  return value.trim().replace(/[\s|:]+/g, "_").slice(0, 40);
}

/** 本文の上限。通知の本文は200文字以内を求めているので、大きく外れた返答は読み違いとして捨てる。 */
const MAX_TEXT_LENGTH = 600;

/**
 * モデルの返答を読む。1行目は `種類|候補|予定の状態`、2行目以降が本文。
 *
 * **知らない形なら黙る**（nullを返す。`parseChoice()` と同じ）。許していない種類（オフの種類・
 * 曜日で対象外の種類）も捨てる——モデルが指示を外しても、オフにした提案は届かない。
 */
export function parseProactiveReply(answer: string, allowed: readonly ProactiveKind[]): ProactiveSuggestion | null {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length < 2 || lines[0] === PROACTIVE_SKIP_TOKEN) return null;

  const [kind, candidate, fingerprint, ...rest] = lines[0].split("|").map((part) => part.trim());
  if (rest.length > 0) return null;

  const matched = allowed.find((value) => value === kind);
  if (!matched) return null;

  const candidateKey = sanitizeKeyPart(candidate ?? "");
  const fingerprintKey = sanitizeKeyPart(fingerprint ?? "");
  if (candidateKey === "" || fingerprintKey === "") return null;

  const text = lines.slice(1).join("\n");
  if (text.length > MAX_TEXT_LENGTH) return null;

  return { kind: matched, candidate: candidateKey, fingerprint: fingerprintKey, text };
}

/**
 * 重複抑制の鍵（`NotificationLog.dedupeKey`）。**同じ週・同じ種類・同じ候補・同じ予定状態**で同じ値になる。
 *
 * 候補の名前は読み戻せるように鍵の中へそのまま残す（最近伝えた候補を次の判定へ渡すため。
 * `recentCandidates()`）。予定の状態はハッシュにして長さを収める。`VarChar(120)` に収まる。
 */
export function proactiveDedupeKey(suggestion: ProactiveSuggestion, at: Date): string {
  const state = createHash("sha256").update(suggestion.fingerprint).digest("hex").slice(0, 10);

  return [jstWeekKey(at), suggestion.kind, suggestion.candidate, state].join(":");
}

/** 鍵から候補の名前を読み戻す。形が違えば `null`。 */
export function candidateFromDedupeKey(key: string): string | null {
  const parts = key.split(":");
  if (parts.length !== 4) return null;

  return parts[2] === "" ? null : parts[2];
}
