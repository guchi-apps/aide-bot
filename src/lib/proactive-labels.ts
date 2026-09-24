/**
 * 先回りの提案（#325）の種類・頻度・設定の型と表示名。**クライアントコンポーネントからimportする。**
 *
 * `node:crypto` など判定の道具（`proactive-rule.ts`）を持ち込まないよう分けてある。
 */

export type ProactiveKind = "weekend" | "free_time" | "ongoing";

export const PROACTIVE_KINDS: readonly ProactiveKind[] = ["weekend", "free_time", "ongoing"];

export const PROACTIVE_KIND_LABELS: Record<ProactiveKind, string> = {
  weekend: "週末の空きと、やりたいこと",
  free_time: "予定の変更でできた空き時間",
  ongoing: "未完了の用件に着手しやすい時間",
};

export type ProactiveFrequency = "daily" | "twice_weekly" | "weekly";

export const PROACTIVE_FREQUENCIES: readonly ProactiveFrequency[] = ["daily", "twice_weekly", "weekly"];

export const PROACTIVE_FREQUENCY_LABELS: Record<ProactiveFrequency, string> = {
  daily: "1日1件まで",
  twice_weekly: "週2件まで",
  weekly: "週1件まで",
};

export type ProactiveSettings = {
  weekend: boolean;
  freeTime: boolean;
  ongoing: boolean;
  quietStart: number;
  quietEnd: number;
  avoidWork: boolean;
  frequency: ProactiveFrequency;
};

/** DBの文字列を型へ落とす。知らない値は既定へ戻す（画面の値は書き換えられるため）。 */
export function normalizeFrequency(value: unknown): ProactiveFrequency {
  return PROACTIVE_FREQUENCIES.find((frequency) => frequency === value) ?? "daily";
}

