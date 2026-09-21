import { usageFeatureLabel, usageFeatureRank } from "@/lib/usage-feature";

/**
 * ops-dashboardの「アプリ別のAI利用」へ返す使用量の組み立て（#297）。
 *
 * **Prismaを引き込まない純粋なモジュール。** DBから取り出す側は `@/lib/usage` の
 * `aiUsageGroups()`。応答の形の正はops-dashboardの `src/lib/ai-app-usage/parse.ts`
 * （README「アプリ別のAI利用」）で、**1行でも形が違えば応答全体が「取得不可」になる**。
 * 形を変えるときは向こうの検証を先に読むこと。
 *
 * **`inputTokens` はキャッシュに載らなかった分だけ。** 画面の使用量（`promptTokens()`）が出す
 * 「キャッシュ込みの入力合計」とは別物で、向こうが自分でキャッシュを足して合計を出す。
 * ここで足して返すと二重に数えられる。
 */

/** DB側で（機能×モデルに）畳んだ1グループ。Prismaの `groupBy` の結果を均した形。 */
export type UsageGroup = {
  feature: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type UsageTotals = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AiUsageFeatureRow = {
  label: string;
  model: string;
  last24h: UsageTotals;
  last7d: UsageTotals;
};

export type AiUsageReport = { features: AiUsageFeatureRow[] };

const EMPTY_TOTALS: UsageTotals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function add(total: UsageTotals, group: UsageGroup): UsageTotals {
  return {
    calls: total.calls + group.calls,
    inputTokens: total.inputTokens + group.inputTokens,
    outputTokens: total.outputTokens + group.outputTokens,
    cacheReadTokens: total.cacheReadTokens + group.cacheReadTokens,
    cacheWriteTokens: total.cacheWriteTokens + group.cacheWriteTokens,
  };
}

/** 各項目を大きい方に揃える。7日間が24時間を下回らないようにするための保険。 */
function atLeast(total: UsageTotals, floor: UsageTotals): UsageTotals {
  return {
    calls: Math.max(total.calls, floor.calls),
    inputTokens: Math.max(total.inputTokens, floor.inputTokens),
    outputTokens: Math.max(total.outputTokens, floor.outputTokens),
    cacheReadTokens: Math.max(total.cacheReadTokens, floor.cacheReadTokens),
    cacheWriteTokens: Math.max(total.cacheWriteTokens, floor.cacheWriteTokens),
  };
}

/**
 * 期間ごとのグループを、機能名×モデルの1行へまとめる。
 *
 * - **行は、どちらかの期間に呼び出しがあった組み合わせ。** 24時間に呼び出しが無い行は0で埋める
 *   （向こうは両方の期間を必須にしている）。24時間は7日間に含まれるはずなので、7日間が24時間を
 *   下回る（2本の問い合わせのあいだに行が増えた）ときは24時間に揃える
 * - **`feature` の値が違っても同じ名前になるものは1行へ足す**（空文字と対応表に無い値は
 *   どちらも「その他」）。「機能×モデルごとに1行」を守るため
 * - 並びは機能の表の順→モデル名。呼ぶたびに順序が揺れると、向こうの画面の行が入れ替わる
 */
export function buildAiUsageReport(params: {
  last24h: UsageGroup[];
  last7d: UsageGroup[];
}): AiUsageReport {
  const rows = new Map<string, AiUsageFeatureRow>();

  const fold = (groups: UsageGroup[], period: "last24h" | "last7d") => {
    for (const group of groups) {
      const label = usageFeatureLabel(group.feature);
      // 区切りに使う文字が機能名・モデル名に現れないよう、JSONで鍵にする。
      const key = JSON.stringify([label, group.model]);

      let row = rows.get(key);
      if (!row) {
        row = { label, model: group.model, last24h: EMPTY_TOTALS, last7d: EMPTY_TOTALS };
        rows.set(key, row);
      }
      row[period] = add(row[period], group);
    }
  };

  fold(params.last7d, "last7d");
  fold(params.last24h, "last24h");

  const features = [...rows.values()]
    .map((row) => ({ ...row, last7d: atLeast(row.last7d, row.last24h) }))
    .sort(
      (a, b) =>
        usageFeatureRank(a.label) - usageFeatureRank(b.label) ||
        (a.model < b.model ? -1 : a.model > b.model ? 1 : 0),
    );

  return { features };
}
