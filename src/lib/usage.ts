import { CHAT_MODEL } from "@/lib/anthropic";
import { db } from "@/lib/db";

/**
 * APIの消費量（#51）。単価・集計・表示の整形をここへ閉じる。
 *
 * **このモジュールはサーバー専用。** `@/lib/anthropic` 経由でAnthropic SDKを、`@/lib/db` 経由で
 * Prismaを引き込むため、クライアントコンポーネントからimportしないこと（`src/lib/app-version.ts`
 * と同じ理由で、バンドルへ丸ごと入る）。使用量の画面はサーバーコンポーネントで組み立てている。
 */

/** 100万トークンあたりの単価（USD）。 */
export type ModelPricing = {
  input: number;
  output: number;
  /** プロンプトキャッシュへの書き込み（TTL 5分）。 */
  cacheWrite: number;
  /** プロンプトキャッシュからの読み出し。 */
  cacheRead: number;
};

/**
 * モデルごとの単価。
 *
 * **Anthropicが単価を変えたらここを直す。** 画面に出るのはこの表からの概算で、
 * 実際の請求額ではない。過去に保存した返答も保存時のモデル名で引き直すため、
 * 使うのをやめたモデルの行も消さずに残す。
 *
 * 出典: https://claude.com/pricing#api（2026-08-25 時点）
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 },
};

/**
 * 円で見るための換算レート。
 *
 * 為替APIへ問い合わせると依存も実費も増えるため、定数で持つ「参考値」として扱う。
 * 画面にもこのレートを併記して、実際の請求と一致しないことが分かるようにする。
 */
export const USD_JPY_RATE = 155;

/** 保存された1件ぶんのトークン数。数えていない発言はnullで入っている。 */
export type UsageRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
};

/** 足し上げた結果。`costUsd` はこのアプリが数えたトークン数からの概算。 */
export type UsageSummary = {
  /** トークン数が残っている返答の件数（=秘書との往復数）。 */
  replies: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

export const EMPTY_SUMMARY: UsageSummary = {
  replies: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
};

/**
 * 単価を引く。表に無いモデルは、いま使っているモデルの単価で概算する。
 *
 * 0円として捨てると「使っていない」と読めてしまうため、近い値を出して概算だと断る方を採る。
 */
function pricingFor(model: string | null): ModelPricing {
  return MODEL_PRICING[model ?? ""] ?? MODEL_PRICING[CHAT_MODEL] ?? MODEL_PRICING["claude-opus-5"];
}

/** 1件ぶんの概算費用（USD）。 */
export function estimateCostUsd(row: UsageRow): number {
  const pricing = pricingFor(row.model);

  return (
    ((row.inputTokens ?? 0) * pricing.input +
      (row.outputTokens ?? 0) * pricing.output +
      (row.cacheWriteTokens ?? 0) * pricing.cacheWrite +
      (row.cacheReadTokens ?? 0) * pricing.cacheRead) /
    1_000_000
  );
}

/** 複数件を足し上げる。トークン数がまったく残っていない行は件数にも入れない。 */
export function summarize(rows: UsageRow[]): UsageSummary {
  return rows.reduce<UsageSummary>((total, row) => {
    const counted =
      row.inputTokens !== null ||
      row.outputTokens !== null ||
      row.cacheWriteTokens !== null ||
      row.cacheReadTokens !== null;

    if (!counted) return total;

    return {
      replies: total.replies + 1,
      inputTokens: total.inputTokens + (row.inputTokens ?? 0),
      outputTokens: total.outputTokens + (row.outputTokens ?? 0),
      cacheWriteTokens: total.cacheWriteTokens + (row.cacheWriteTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (row.cacheReadTokens ?? 0),
      costUsd: total.costUsd + estimateCostUsd(row),
    };
  }, EMPTY_SUMMARY);
}

// --- 期間の区切り ---
// サーバーのタイムゾーンでの「今日」「今月」で切る。日付の丸めをクライアントでやると、
// サーバーとブラウザのタイムゾーン差でハイドレーションがずれる（conversationGroupLabelと同じ）。

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

// --- 画面へ出す形 ---

/**
 * 概算費用の表示。
 *
 * 1セントに満たない額を `$0.00` と出すと「使っていない」と読めるため、そこだけ言葉にする。
 */
export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "$0.01未満";
  return `$${usd.toFixed(2)}`;
}

/** 円での参考表示。レートは `USD_JPY_RATE` の固定値。 */
export function formatJpy(usd: number): string {
  const yen = Math.round(usd * USD_JPY_RATE);
  if (usd > 0 && yen === 0) return "約1円未満";
  return `約${yen.toLocaleString("ja-JP")}円`;
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString("ja-JP");
}

// --- DBからの読み出し ---
// 使用量の画面と左メニューの両方から呼ぶ。他人ぶんが混ざらないよう、必ずuserIdで絞る。

type UsageWhere = { userId: string; since?: Date };

function whereClause({ userId, since }: UsageWhere) {
  return {
    role: "ASSISTANT" as const,
    conversation: { userId },
    ...(since ? { createdAt: { gte: since } } : {}),
    // トークン数を数えていない返答（この機能より前のもの）は最初から除く。
    NOT: { inputTokens: null, outputTokens: null },
  };
}

/**
 * 期間ぶんの合計。`since` を省くと累計。
 *
 * モデル別に集計してから足すのは、単価がモデルごとに違うため。件数ぶんの行を持ち帰らずに
 * 済むので、相談が増えても読み出す量が増えない。
 */
export async function usageSummary(params: UsageWhere): Promise<UsageSummary> {
  const groups = await db.message.groupBy({
    by: ["model"],
    where: whereClause(params),
    _count: { _all: true },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheWriteTokens: true,
      cacheReadTokens: true,
    },
  });

  return groups.reduce<UsageSummary>(
    (total, group) => ({
      replies: total.replies + group._count._all,
      inputTokens: total.inputTokens + (group._sum.inputTokens ?? 0),
      outputTokens: total.outputTokens + (group._sum.outputTokens ?? 0),
      cacheWriteTokens: total.cacheWriteTokens + (group._sum.cacheWriteTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (group._sum.cacheReadTokens ?? 0),
      costUsd:
        total.costUsd +
        estimateCostUsd({
          model: group.model,
          inputTokens: group._sum.inputTokens,
          outputTokens: group._sum.outputTokens,
          cacheWriteTokens: group._sum.cacheWriteTokens,
          cacheReadTokens: group._sum.cacheReadTokens,
        }),
    }),
    EMPTY_SUMMARY,
  );
}

/** 日別に並べた1日ぶん。 */
export type DailyUsage = {
  /** その日の0時。 */
  date: Date;
  summary: UsageSummary;
};

/**
 * 直近 `days` 日ぶんを日別に返す（使わなかった日も0で並べる）。
 *
 * 日ごとの合計はSQLで作れるが、境界がサーバーのタイムゾーンに依存するため、行を持ち帰って
 * JS側で丸める。対象は直近ぶんだけなので、持ち帰る量はたかが知れている。
 */
export async function dailyUsage(userId: string, days: number, now: Date): Promise<DailyUsage[]> {
  const since = addDays(startOfDay(now), -(days - 1));

  const rows = await db.message.findMany({
    where: whereClause({ userId, since }),
    select: {
      createdAt: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheWriteTokens: true,
      cacheReadTokens: true,
    },
  });

  const buckets = new Map<number, UsageRow[]>();
  for (const row of rows) {
    const key = startOfDay(row.createdAt).getTime();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  return Array.from({ length: days }, (_, index) => {
    const date = addDays(since, index);
    return { date, summary: summarize(buckets.get(date.getTime()) ?? []) };
  });
}
