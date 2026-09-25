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

export type SettingsChange =
  | { key: "briefing_time"; hour: number; minute: 0 | 30 }
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

/** カードに出す行（項目名・新しい値）。 */
export function describeChange(change: SettingsChange): { label: string; value: string }[] {
  if (change.key === "briefing_time") {
    return [{ label: "朝の見通しの時刻", value: clock(change.hour, change.minute) }];
  }

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
  "上の対象に無い設定（ニュースの種類・定時のお知らせ・他のアプリの設定など）は、まだこの経路では変えられないと伝え、設定の画面を案内する",
];
