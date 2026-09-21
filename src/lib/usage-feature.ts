/**
 * 使用量（`ApiUsage`）の「どの機能の呼び出しか」（#297）。
 *
 * **Prismaを引き込まない純粋なモジュール。** 対応表そのものをテストから読めるようにするため、
 * `@/lib/usage`（DBに触れる）とは別に置いてある。
 *
 * モデル名から機能を割り出す形は採らなかった。相談のモデルは設定の画面から選べる（Sol・Terra・
 * Luna）ため、お知らせ選定・話題（Luna）、要約・自宅の取り込み（Terra）、朝の見通し（Sol）と
 * 同じ名前が別の機能として現れる。**機能を足したら、ここへ足して呼び出し側の
 * `recordApiUsage()` に渡すこと**（渡し忘れは型で落ちる）。
 */

export type UsageFeature =
  | "chat"
  | "compact"
  | "briefing"
  | "notice"
  | "topic"
  | "home_profile";

/** 使用量APIに出す機能名（ops-dashboardの画面にそのまま載る）。 */
export const USAGE_FEATURE_LABELS: Record<UsageFeature, string> = {
  chat: "チャット",
  compact: "会話の要約",
  briefing: "朝の見通し",
  notice: "お知らせの選定",
  topic: "話題の仕入れ",
  home_profile: "自宅情報の取り込み",
};

/**
 * 機能が分からない行の名前。
 *
 * `feature` 列を足す前の記録（空文字）と、対応表に無い値（機能を消した後に残った行）が入る。
 * 捨てると合計が黙って少なくなるので、名前を付けて残す。
 */
export const UNKNOWN_FEATURE_LABEL = "その他（機能の記録なし）";

/** 表に出す並び順（この順に並べ、その他は末尾）。 */
const FEATURE_ORDER = Object.keys(USAGE_FEATURE_LABELS);

export function usageFeatureLabel(feature: string): string {
  return Object.hasOwn(USAGE_FEATURE_LABELS, feature)
    ? USAGE_FEATURE_LABELS[feature as UsageFeature]
    : UNKNOWN_FEATURE_LABEL;
}

/** 表の並び順の位置。対応表に無いものは末尾。 */
export function usageFeatureRank(label: string): number {
  const index = FEATURE_ORDER.findIndex(
    (feature) => USAGE_FEATURE_LABELS[feature as UsageFeature] === label,
  );
  return index === -1 ? FEATURE_ORDER.length : index;
}
