/**
 * 秘書が返答に添える「設定の変更案」の解析と検証（#346）。**クライアントコンポーネントからもimportする**
 * ので、PrismaやNodeのモジュールに触れないこと（適用は `settings-apply.ts`）。
 *
 * 変更案は返答の本文の中に、次の形の囲みとして入る。本文へ入れておくと、`Message` の列を増やさずに
 * 再読み込み後も残り、モデルへ渡す履歴にも「何を提案したか」が残る。
 *
 * ```settings-change
 * {"changes":[{"key":"briefing_time","hour":6,"minute":30}]}
 * ```
 *
 * **モデルは書き込まない。** 反映するのは利用者が「変更する」を押したときだけで、その入口
 * （`POST /api/settings/actions`）が同じ検証をもう一度通す。壊れた案は捨てる（本文だけを残す）。
 */

import {
  PROACTIVE_FREQUENCIES,
  PROACTIVE_FREQUENCY_LABELS,
  type ProactiveFrequency,
} from "./proactive-labels.ts";
import { SCHEDULED_PUSH_ALL, WEEKDAYS, daysToMask, maskToDays } from "./scheduled-push-rule.ts";
import {
  TOPIC_LABEL_MAX,
  TOPIC_SCOPE_MAX,
  TOPIC_SHORT_MAX,
  validateTopicCategoryInput,
} from "./topic-categories.ts";

/**
 * 定時のお知らせ（#344）を「どれか」指す条件。渡した項目がすべて一致する1件に解決する
 * （適用時に0件・2件以上なら拒否）。`category` は `all` か話題の種類の名前。
 */
export type ScheduledPushTarget = { days?: number[]; hour?: number; minute?: 0 | 30; category?: string };

export type ScheduledPushFields = {
  days: number[];
  hour: number;
  minute: 0 | 30;
  category: string;
  enabled?: boolean;
};

export type SettingsChange =
  | { key: "briefing_time"; hour: number; minute: 0 | 30 }
  // ニュースの種類（#345）。既存の種類は名前（label か short）で指し、適用時に1件へ解決する（#352）。
  | { key: "topic_category"; action: "add"; label: string; short: string; scope: string }
  | {
      key: "topic_category";
      action: "update";
      target: string;
      label?: string;
      short?: string;
      scope?: string;
      enabled?: boolean;
    }
  | { key: "topic_category"; action: "delete"; target: string }
  // 定時のお知らせ（#344）。
  | ({ key: "scheduled_push"; action: "add" } & ScheduledPushFields)
  | ({ key: "scheduled_push"; action: "update"; target: ScheduledPushTarget } & Partial<ScheduledPushFields>)
  | { key: "scheduled_push"; action: "delete"; target: ScheduledPushTarget }
  | {
      key: "proactive";
      weekend?: boolean;
      freeTime?: boolean;
      ongoing?: boolean;
      avoidWork?: boolean;
      quietStart?: number;
      quietEnd?: number;
      frequency?: ProactiveFrequency;
    };

/** 1回の案に入れられる変更の数。 */
export const MAX_CHANGES = 4;

const FENCE = /```settings-change\s*\n([\s\S]*?)```/g;

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

const PROACTIVE_BOOLEANS = ["weekend", "freeTime", "ongoing", "avoidWork"] as const;
const PROACTIVE_HOURS = ["quietStart", "quietEnd"] as const;

const NAME_MAX = 30;

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= NAME_MAX;
}

function isMinute(value: unknown): value is 0 | 30 {
  return value === 0 || value === 30;
}

function isDays(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
  );
}

/** 種類の名前（label / short）。`SCHEDULED_PUSH_ALL` もここでは文字列として通す。 */
function isCategoryRef(value: unknown): value is string {
  return isName(value);
}

function validateTopicCategory(item: Record<string, unknown>): SettingsChange | null {
  if (item.action === "add") {
    const result = validateTopicCategoryInput(item);
    if (!result.ok) return null;
    return { key: "topic_category", action: "add", ...result.value };
  }
  if (item.action === "delete") {
    return isName(item.target) ? { key: "topic_category", action: "delete", target: item.target.trim() } : null;
  }
  if (item.action === "update") {
    if (!isName(item.target)) return null;
    const change: Extract<SettingsChange, { key: "topic_category"; action: "update" }> = {
      key: "topic_category",
      action: "update",
      target: item.target.trim(),
    };
    // 渡した項目だけを検証する（長さの規則は追加と同じ）。
    const limits = { label: TOPIC_LABEL_MAX, short: TOPIC_SHORT_MAX, scope: TOPIC_SCOPE_MAX } as const;
    for (const field of ["label", "short", "scope"] as const) {
      if (!(field in item)) continue;
      const value = item[field];
      if (typeof value !== "string") return null;
      const tidy = value.replace(/[\p{Cc}\s]+/gu, " ").trim();
      if (tidy === "" || tidy.length > limits[field]) return null;
      change[field] = tidy;
    }
    if ("enabled" in item) {
      if (typeof item.enabled !== "boolean") return null;
      change.enabled = item.enabled;
    }
    return Object.keys(change).length > 3 ? change : null;
  }
  return null;
}

function validateTarget(raw: unknown): ScheduledPushTarget | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const target: ScheduledPushTarget = {};
  if ("days" in item) {
    if (!isDays(item.days)) return null;
    target.days = item.days;
  }
  if ("hour" in item) {
    if (!isHour(item.hour)) return null;
    target.hour = item.hour;
  }
  if ("minute" in item) {
    if (!isMinute(item.minute)) return null;
    target.minute = item.minute;
  }
  if ("category" in item) {
    if (!isCategoryRef(item.category)) return null;
    target.category = item.category.trim();
  }
  return Object.keys(target).length > 0 ? target : null;
}

function validateScheduledPush(item: Record<string, unknown>): SettingsChange | null {
  if (item.action === "add") {
    if (!isDays(item.days) || !isHour(item.hour) || !isMinute(item.minute) || !isCategoryRef(item.category)) {
      return null;
    }
    const change: SettingsChange = {
      key: "scheduled_push",
      action: "add",
      days: item.days,
      hour: item.hour,
      minute: item.minute,
      category: item.category.trim(),
    };
    if ("enabled" in item) {
      if (typeof item.enabled !== "boolean") return null;
      change.enabled = item.enabled;
    }
    return change;
  }
  const target = validateTarget(item.target);
  if (!target) return null;
  if (item.action === "delete") return { key: "scheduled_push", action: "delete", target };
  if (item.action !== "update") return null;

  const change: Extract<SettingsChange, { key: "scheduled_push"; action: "update" }> = {
    key: "scheduled_push",
    action: "update",
    target,
  };
  if ("days" in item) {
    if (!isDays(item.days)) return null;
    change.days = item.days;
  }
  if ("hour" in item) {
    if (!isHour(item.hour)) return null;
    change.hour = item.hour;
  }
  if ("minute" in item) {
    if (!isMinute(item.minute)) return null;
    change.minute = item.minute;
  }
  if ("category" in item) {
    if (!isCategoryRef(item.category)) return null;
    change.category = item.category.trim();
  }
  if ("enabled" in item) {
    if (typeof item.enabled !== "boolean") return null;
    change.enabled = item.enabled;
  }
  return Object.keys(change).length > 3 ? change : null;
}

/** 1件を検証する。渡された項目のうち、知らないものは捨て、値が不正なら全体を捨てる（null）。 */
export function validateChange(raw: unknown): SettingsChange | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;

  if (item.key === "briefing_time") {
    if (!isHour(item.hour) || (item.minute !== 0 && item.minute !== 30)) return null;
    return { key: "briefing_time", hour: item.hour, minute: item.minute };
  }

  if (item.key === "proactive") {
    const change: Extract<SettingsChange, { key: "proactive" }> = { key: "proactive" };
    for (const field of PROACTIVE_BOOLEANS) {
      if (!(field in item)) continue;
      if (typeof item[field] !== "boolean") return null;
      change[field] = item[field];
    }
    for (const field of PROACTIVE_HOURS) {
      if (!(field in item)) continue;
      if (!isHour(item[field])) return null;
      change[field] = item[field];
    }
    if ("frequency" in item) {
      const frequency = PROACTIVE_FREQUENCIES.find((value) => value === item.frequency);
      if (!frequency) return null;
      change.frequency = frequency;
    }
    return Object.keys(change).length > 1 ? change : null;
  }

  if (item.key === "topic_category") return validateTopicCategory(item);
  if (item.key === "scheduled_push") return validateScheduledPush(item);

  return null;
}

/** 本文から囲みを取り除き、検証を通った変更だけを返す。囲みが無ければ本文はそのまま。 */
export function extractProposal(content: string): { text: string; changes: SettingsChange[] } {
  const changes: SettingsChange[] = [];

  const text = content
    .replace(FENCE, (_match, body: string) => {
      try {
        const parsed: unknown = JSON.parse(body);
        const list =
          typeof parsed === "object" && parsed !== null && "changes" in parsed
            ? (parsed as { changes: unknown }).changes
            : null;
        if (Array.isArray(list)) {
          for (const raw of list) {
            const change = validateChange(raw);
            if (change && changes.length < MAX_CHANGES) changes.push(change);
          }
        }
      } catch {
        // 壊れた案は捨てる。
      }
      return "";
    })
    .trim();

  return { text, changes };
}

/** 生成の途中（囲みが閉じていない）でも、囲みの部分を見せないための除去。 */
export function stripProposal(content: string): string {
  return extractProposal(content).text.replace(/```settings-change[\s\S]*$/, "").trim();
}

function clock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, "0")}`;
}

export function daysLabel(days: readonly number[]): string {
  const mask = daysToMask(days);
  return mask === 0b1111111 ? "毎日" : maskToDays(mask).map((day) => WEEKDAYS[day]).join("・");
}

function categoryLabel(category: string): string {
  return category === SCHEDULED_PUSH_ALL ? "すべての種類" : category;
}

function describeTopicCategory(
  change: Extract<SettingsChange, { key: "topic_category" }>,
): { label: string; value: string }[] {
  if (change.action === "add") {
    return [
      { label: "ニュースの種類を追加", value: change.label },
      { label: "集める内容", value: change.scope },
    ];
  }
  if (change.action === "delete") {
    return [{ label: "ニュースの種類を削除", value: `${change.target}（仕入れ済みの記事は「その他」になります）` }];
  }
  const rows = [{ label: "ニュースの種類を変更", value: change.target }];
  if (change.label !== undefined) rows.push({ label: "名前", value: change.label });
  if (change.short !== undefined) rows.push({ label: "短い名前", value: change.short });
  if (change.scope !== undefined) rows.push({ label: "集める内容", value: change.scope });
  if (change.enabled !== undefined) rows.push({ label: "仕入れ", value: change.enabled ? "する" : "しない" });
  return rows;
}

function describeScheduledPush(
  change: Extract<SettingsChange, { key: "scheduled_push" }>,
): { label: string; value: string }[] {
  if (change.action === "add") {
    return [
      { label: "定時のお知らせを追加", value: `${daysLabel(change.days)} ${clock(change.hour, change.minute)}` },
      { label: "話題の種類", value: categoryLabel(change.category) },
    ];
  }
  const t = change.target;
  const targetText = [
    t.days ? daysLabel(t.days) : null,
    t.hour !== undefined ? clock(t.hour, t.minute ?? 0) : null,
    t.category ? categoryLabel(t.category) : null,
  ]
    .filter(Boolean)
    .join(" ");
  if (change.action === "delete") return [{ label: "定時のお知らせを削除", value: targetText }];

  const rows = [{ label: "定時のお知らせを変更", value: targetText }];
  if (change.days !== undefined) rows.push({ label: "曜日", value: daysLabel(change.days) });
  if (change.hour !== undefined || change.minute !== undefined) {
    rows.push({
      label: "時刻",
      value: change.hour !== undefined ? clock(change.hour, change.minute ?? 0) : `分を${change.minute}分に`,
    });
  }
  if (change.category !== undefined) rows.push({ label: "話題の種類", value: categoryLabel(change.category) });
  if (change.enabled !== undefined) rows.push({ label: "通知", value: change.enabled ? "オン" : "オフ" });
  return rows;
}

/** カードに出す行（項目名・新しい値）。 */
export function describeChange(change: SettingsChange): { label: string; value: string }[] {
  if (change.key === "briefing_time") {
    return [{ label: "朝の見通しの時刻", value: clock(change.hour, change.minute) }];
  }

  if (change.key === "topic_category") return describeTopicCategory(change);
  if (change.key === "scheduled_push") return describeScheduledPush(change);

  const rows: { label: string; value: string }[] = [];
  const onOff = (value: boolean) => (value ? "届ける" : "届けない");
  if (change.weekend !== undefined) rows.push({ label: "提案: 週末の空き", value: onOff(change.weekend) });
  if (change.freeTime !== undefined) rows.push({ label: "提案: 予定変更の空き", value: onOff(change.freeTime) });
  if (change.ongoing !== undefined) rows.push({ label: "提案: 未完了の用件", value: onOff(change.ongoing) });
  if (change.avoidWork !== undefined) {
    rows.push({ label: "提案: 平日の勤務帯", value: change.avoidWork ? "避ける" : "避けない" });
  }
  if (change.quietStart !== undefined) rows.push({ label: "静かな時間の開始", value: `${change.quietStart}時` });
  if (change.quietEnd !== undefined) rows.push({ label: "静かな時間の終了", value: `${change.quietEnd}時` });
  if (change.frequency !== undefined) {
    rows.push({ label: "提案の頻度", value: PROACTIVE_FREQUENCY_LABELS[change.frequency] });
  }
  return rows;
}

/** 秘書のプロンプトに載せる、変更案の書き方と対象の一覧。 */
export const SETTINGS_PROPOSAL_RULES = [
  "利用者がこのアプリの設定（通知の時刻など）の変更を頼んだら、**自分では変更せず**、変更案を返答の末尾に次の形の囲みで添える。" +
    "囲みは利用者には「変更する」ボタンのカードとして見える。本文では「次の内容でよろしいですか。ボタンを押すと反映されます」と伝え、" +
    "**変わったとは言わない**（押されるまで何も変わっていない）。決まっていない値（時刻を聞いていない等）は推測で埋めず、先に聞き返す",
  '囲みの形: ```settings-change の行の次にJSON `{"changes":[…]}` を置き、``` で閉じる。changes は最大4件',
  '対象1（朝の見通しを届ける時刻）: `{"key":"briefing_time","hour":0〜23,"minute":0か30}`',
  '対象2（先回りの提案）: `{"key":"proactive", …}` に変えたい項目だけを入れる。' +
    "weekend / freeTime / ongoing / avoidWork は真偽値、quietStart / quietEnd は0〜23の時、" +
    "frequency は daily（1日1件）/ twice_weekly（週2件）/ weekly（週1件）",
  '対象3（ニュースの種類）: 追加 `{"key":"topic_category","action":"add","label":"名前","short":"短い名前(省略可)","scope":"集める内容"}`、' +
    '変更 `{"key":"topic_category","action":"update","target":"今の名前",` と、変えたい label / short / scope / enabled(真偽値) `}`、' +
    '削除 `{"key":"topic_category","action":"delete","target":"今の名前"}`。既存の種類は名前で指す（種類の名前が分からないときは先に聞き返す）',
  '対象4（定時のお知らせ。話題の見出しを決まった曜日・時刻に届ける）: 追加 `{"key":"scheduled_push","action":"add","days":[0〜6。日曜=0],"hour":0〜23,"minute":0か30,"category":"all か種類の名前"}`、' +
    '変更 `{"key":"scheduled_push","action":"update","target":{既存を指す days / hour / minute / category のうち分かるもの},` と、変えたい days / hour / minute / category / enabled(真偽値) `}`、' +
    '削除 `{"key":"scheduled_push","action":"delete","target":{…}}`。削除は取り消せないので、本文でも何を消すか明示する',
  "上の対象に無い設定（他のアプリの設定など）は、まだこの経路では変えられないと伝え、設定の画面を案内する",
];
