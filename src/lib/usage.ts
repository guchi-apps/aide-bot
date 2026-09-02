import { MODEL_PRICING, billingKind, type BillingKind, type ModelPricing } from "@/lib/chat-model";
import { db } from "@/lib/db";

/**
 * APIの消費量（#51）。集計と表示の整形をここへ閉じる。
 *
 * **単価表（`MODEL_PRICING`）は `@/lib/chat-model` へ移した**（#71）。モデルを選ぶ画面が
 * クライアントコンポーネントで、単価をバッジに出すため。
 *
 * **#133から、記録には課金の形が違う2種類が混ざる。** Codex（ChatGPTのサブスク定額）で動く
 * 相談・お知らせ選定と、Anthropic（従量課金）で動く朝の見通し。**足し上げるときは必ず
 * `billingKind()` で割ってから使うこと**——1つの金額へ混ぜると、定額のはずの相談に費用が
 * 付いているように見える。取り出し口（`usageBreakdown()` / `dailyUsage()`）は割った形でしか
 * 返さない。
 *
 * **このモジュールはサーバー専用。** `@/lib/db` 経由でPrismaを引き込むため、クライアント
 * コンポーネントからimportしないこと（`src/lib/app-version.ts` と同じ理由で、バンドルへ
 * 丸ごと入る）。使用量の画面はサーバーコンポーネントで組み立てている。
 */

/**
 * 円で見るための換算レート。
 *
 * 為替APIへ問い合わせると依存も実費も増えるため、定数で持つ「参考値」として扱う。
 * 画面にもこのレートを併記して、実際の請求と一致しないことが分かるようにする。
 */
export const USD_JPY_RATE = 155;

/**
 * API呼び出し1回ぶんのトークン数。
 *
 * `ApiUsage` の行から作るほか、DB側で合計した結果（Prismaの `_sum` はnull許容）も同じ形で扱う。
 */
export type UsageRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
};

/** 足し上げた結果。`costUsd` はこのアプリが数えたトークン数からの概算。 */
export type UsageSummary = {
  /** APIを呼んだ回数。いまは1往復＝1回。 */
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  /** 定額制（Codex）ぶんは常に0。 */
  costUsd: number;
  /**
   * この期間に実際に呼んだモデル名（重複なし・古い順ではない）。
   *
   * 画面の注記が「いま選んでいるモデル」ではなく**この集計に入っているモデル**の単価を
   * 出せるようにするために持つ。モデルを切り替えた前後の記録が混ざった期間では、
   * 選択中のモデルだけを書くと注記が嘘になる。
   */
  models: string[];
};

export const EMPTY_SUMMARY: UsageSummary = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd: 0,
  models: [],
};

/**
 * 課金の形で割った集計（#133）。画面はこの単位で節を分ける。
 *
 * **どちらかが0件でも省かない。** 呼び出し側が「記録が1件も無い節は畳む」判断をするため、
 * 空でも `EMPTY_SUMMARY` を入れて返す。
 */
export type UsageBreakdown = Record<BillingKind, UsageSummary>;

/**
 * 入力ぶんのトークン数の合計（#56）。
 *
 * **`inputTokens` はキャッシュに載らなかった残りだけを指す。** プロンプトキャッシュを入れて
 * からは入力の大半がキャッシュ読みへ移るため、この列だけを「入力」として画面に出すと、
 * 実際には同じだけ送っているのに使用量が激減したように見える。画面では必ずこの合計を出し、
 * うちキャッシュから読んだぶんを内訳として添える。
 */
export function promptTokens(row: UsageSummary): number {
  return row.inputTokens + row.cacheReadTokens + row.cacheWriteTokens;
}

/**
 * 単価を引く。**定額制（Codex）のモデルには単価が無いので `null`。**
 *
 * 従量課金のモデルで表に無いものは、既定のモデルの単価で概算する（#51）。0円として捨てると
 * 「使っていない」と読めてしまうため、近い値を出して概算だと断る方を採る。
 *
 * **Codexぶんを既定の単価へ落とさないことが#133の要点。** 落とすと、定額で動いている相談に
 * `claude-opus-5` の単価が付き、概算費用が実態と桁ごと食い違う。
 */
function pricingFor(model: string | null): ModelPricing | null {
  if (billingKind(model) === "subscription") return null;
  return MODEL_PRICING[model ?? ""] ?? MODEL_PRICING["claude-opus-5"];
}

/** 1件ぶんの概算費用（USD）。定額制のモデルは0。 */
export function estimateCostUsd(row: UsageRow): number {
  const pricing = pricingFor(row.model);
  if (!pricing) return 0;

  return (
    ((row.inputTokens ?? 0) * pricing.input +
      (row.outputTokens ?? 0) * pricing.output +
      (row.cacheWriteTokens ?? 0) * pricing.cacheWrite +
      (row.cacheReadTokens ?? 0) * pricing.cacheRead) /
    1_000_000
  );
}

/** 複数件を足し上げる。**課金の形が混ざった配列を渡さないこと**（`splitByBilling()` で割る）。 */
export function summarize(rows: UsageRow[]): UsageSummary {
  return rows.reduce<UsageSummary>((total, row) => {
    return {
      calls: total.calls + 1,
      inputTokens: total.inputTokens + (row.inputTokens ?? 0),
      outputTokens: total.outputTokens + (row.outputTokens ?? 0),
      cacheWriteTokens: total.cacheWriteTokens + (row.cacheWriteTokens ?? 0),
      cacheReadTokens: total.cacheReadTokens + (row.cacheReadTokens ?? 0),
      costUsd: total.costUsd + estimateCostUsd(row),
      models: total.models.includes(row.model ?? "") ? total.models : [...total.models, row.model ?? ""],
    };
  }, EMPTY_SUMMARY);
}

/** 課金の形で割ってから足し上げる。 */
export function summarizeByBilling(rows: UsageRow[]): UsageBreakdown {
  return {
    subscription: summarize(rows.filter((row) => billingKind(row.model) === "subscription")),
    metered: summarize(rows.filter((row) => billingKind(row.model) === "metered")),
  };
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
    userId,
    ...(since ? { createdAt: { gte: since } } : {}),
  };
}

/**
 * 期間ぶんの合計を、課金の形で割って返す。`since` を省くと累計。
 *
 * モデル別に集計してから足すのは、単価がモデルごとに違うため。件数ぶんの行を持ち帰らずに
 * 済むので、相談が増えても読み出す量が増えない。**課金の形の判別もモデル名から決まる**ので、
 * このgroupByの結果だけで両方の節を作れる（問い合わせは1本のまま）。
 */
export async function usageBreakdown(params: UsageWhere): Promise<UsageBreakdown> {
  const groups = await db.apiUsage.groupBy({
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

  const fold = (kind: BillingKind): UsageSummary =>
    groups
      .filter((group) => billingKind(group.model) === kind)
      .reduce<UsageSummary>(
        (total, group) => ({
          calls: total.calls + group._count._all,
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
          models: [...total.models, group.model],
        }),
        EMPTY_SUMMARY,
      );

  return { subscription: fold("subscription"), metered: fold("metered") };
}

/** 日別に並べた1日ぶん。課金の形で割ったまま持つ（グラフを節ごとに描くため）。 */
export type DailyUsage = {
  /** その日の0時。 */
  date: Date;
  summary: UsageBreakdown;
};

/**
 * 直近 `days` 日ぶんを日別に返す（使わなかった日も0で並べる）。
 *
 * 日ごとの合計はSQLで作れるが、境界がサーバーのタイムゾーンに依存するため、行を持ち帰って
 * JS側で丸める。対象は直近ぶんだけなので、持ち帰る量はたかが知れている。
 */
export async function dailyUsage(userId: string, days: number, now: Date): Promise<DailyUsage[]> {
  const since = addDays(startOfDay(now), -(days - 1));

  const rows = await db.apiUsage.findMany({
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
    return { date, summary: summarizeByBilling(buckets.get(date.getTime()) ?? []) };
  });
}


// --- DBへの書き込み ---

/**
 * API呼び出し1回ぶんを記録する（#51・#133）。
 *
 * **数える単位は「API呼び出し1回」で、秘書の返答（`Message`）には持たせない。** 1文字も
 * 出ないうちに割り込まれた往復では返答の行そのものが作られないが、入力ぶんはその時点で
 * 使い終わっている。
 *
 * **記録に失敗しても呼び出し元を止めない。** 相談も通知も、記録できないことより返らないことの
 * 方が重い（#51から変えていない）。呼び出し元でtry/catchを書かずに済むよう、ここで飲む。
 *
 * **全部0の回は行を作らない。** Codexでは中断・起動失敗で `turn.completed` が届かず、
 * 使った量が分からない。0として残すと「呼んだのに一切消費しなかった」記録になり、
 * 回数だけが実態より多く見える。
 */
export async function recordApiUsage(params: {
  userId: string;
  /** 相談に紐づかない経路（朝の見通し・お知らせ選定）は `null`。 */
  conversationId: string | null;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
  };
}): Promise<void> {
  const { userId, conversationId, model, usage } = params;

  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheWriteTokens + usage.cacheReadTokens;
  if (total <= 0) return;

  try {
    await db.apiUsage.create({ data: { userId, conversationId, model, ...usage } });
  } catch (error) {
    console.error("[aide-bot] 使用量の記録に失敗した", error);
  }
}
