import type { ReactNode } from "react";

import { MODEL_PRICING } from "@/lib/chat-model";
import {
  USD_JPY_RATE,
  formatJpy,
  formatTokens,
  formatUsd,
  promptTokens,
  type DailyUsage,
  type UsageBreakdown,
  type UsageSummary,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

type Props = {
  today: UsageBreakdown;
  month: UsageBreakdown;
  total: UsageBreakdown;
  /** 古い日から新しい日の順。最後の要素が今日。 */
  daily: DailyUsage[];
  /** 表に出す日数（日別グラフより短くする）。 */
  tableDays: number;
  /** 「8月」のような、今月を指す文言。サーバー側で作って渡す。 */
  monthLabel: string;
  /**
   * いま選んでいるモデル（#71）。定額制の節の注記に出す。
   *
   * 「話す」と「書く」で別々に選べるため複数入る。ここに出るのは**これから使う**モデルで、
   * 上の集計は呼び出した時点のモデルで足し上げてある。
   */
  chatModels: { label: string; model: string }[];
};

/**
 * 使用量の画面（#51・#133）。
 *
 * **課金の形で2節に割る。** Codex（ChatGPTのサブスク定額）で動く相談・お知らせ選定は
 * 「どれだけ使ったか」だけ、Anthropic（従量課金）で動く朝の見通しは今までどおり
 * 「いくら掛かったか」を出す。1つの金額へ足し込むと、定額のはずの経路に費用が付いて見える。
 *
 * **記録が1件も無い節は見出しごと畳む。** #131で朝の見通しもCodexへ移ると従量課金ぶんは
 * 増えなくなり、いずれ累計も0になる。そのとき「$0.00」の節が居座らないようにしてある
 * ——この画面を作り直さずに済ませるための造り。
 *
 * サーバーコンポーネントのまま置いている。数字を見るだけで操作が無く、クライアントにすると
 * `@/lib/usage`（Prismaを引き込む）がバンドルへ入るため。
 */
export function UsageView({ today, month, total, daily, tableDays, monthLabel, chatModels }: Props) {
  const rows = daily.slice(-tableDays).reverse();
  const hasSubscription = total.subscription.calls > 0;
  const hasMetered = total.metered.calls > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5 px-3.5 py-4 md:gap-7 md:px-7 md:py-6">
        {!hasSubscription && !hasMetered && (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            まだ記録がありません。相談を送るか、朝の見通しが届くと、その往復で使ったぶんがここに出ます。
          </p>
        )}

        {hasSubscription && (
          <section className="flex flex-col gap-3">
            <BandHead
              title="相談・お知らせ"
              source="Codex（GPT-5.6）"
              badge="サブスク定額 ・ 費用なし"
            />

            <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
              <VolumeCard label={`今月（${monthLabel}）`} summary={month.subscription} highlighted />
              <VolumeCard label="今日" summary={today.subscription} />
              <VolumeCard label="累計" summary={total.subscription} />
            </div>

            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              <PanelHead title={`日別のトークン量（直近${daily.length}日）`} withLegend />
              <DailyChart daily={daily} value={(summary) => totalTokens(summary)} band="subscription" />
            </section>

            <p className="text-[0.6875rem] leading-relaxed text-muted">
              <b className="font-medium text-foreground">
                ChatGPTのサブスク枠で動くため、ここに費用は発生しません。
              </b>
              上の数字は <Code>codex exec --json</Code> が返す <Code>turn.completed</Code> の
              使用量を、呼び出し1回ぶん1行として記録したものです。
              <b className="font-medium text-foreground">
                残りの利用枠（5時間ごと・週ごと）はこの画面には出せません。
              </b>
              非対話で取得できる口がCodex CLIに無いためで、残量を見るときは端末で{" "}
              <Code>codex</Code> を起動し <Code>/status</Code> を開いてください。
              {selectedModelsNote(chatModels)}
            </p>
          </section>
        )}

        {hasMetered && (
          <section className="flex flex-col gap-3">
            <BandHead title="朝の見通し" source="Claude" badge="従量課金" accented />

            <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
              <MoneyCard label={`今月（${monthLabel}）`} summary={month.metered} highlighted />
              <MoneyCard label="今日" summary={today.metered} />
              <MoneyCard label="累計" summary={total.metered} />
            </div>

            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              <PanelHead title={`日別の概算費用（直近${daily.length}日）`} withLegend />
              <DailyChart daily={daily} value={(summary) => summary.costUsd} band="metered" />
            </section>

            <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
              <PanelHead title={`日別の内訳（直近${rows.length}日）`} />

              {/* PCは表、スマホは1日1行。列を詰めるより、横に出さない方が読める。 */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full border-collapse text-[0.8125rem] tabular-nums">
                  <thead>
                    <tr className="text-[0.6875rem] font-bold tracking-[0.06em] text-muted">
                      <th className="border-b border-border px-2.5 py-2 text-left">日付</th>
                      <th className="border-b border-border px-2.5 py-2 text-right">回数</th>
                      <th className="border-b border-border px-2.5 py-2 text-right">入力トークン</th>
                      <th className="border-b border-border px-2.5 py-2 text-right">
                        うちキャッシュ
                      </th>
                      <th className="border-b border-border px-2.5 py-2 text-right">出力トークン</th>
                      <th className="border-b border-border px-2.5 py-2 text-right">概算費用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ date, summary }) => (
                      <tr key={date.getTime()}>
                        <td className="border-b border-border px-2.5 py-2 text-left">
                          {dayLabel(date, daily)}
                        </td>
                        <td className="border-b border-border px-2.5 py-2 text-right">
                          {summary.metered.calls}
                        </td>
                        <td className="border-b border-border px-2.5 py-2 text-right">
                          {formatTokens(promptTokens(summary.metered))}
                        </td>
                        <td className="border-b border-border px-2.5 py-2 text-right text-muted">
                          {formatTokens(summary.metered.cacheReadTokens)}
                        </td>
                        <td className="border-b border-border px-2.5 py-2 text-right">
                          {formatTokens(summary.metered.outputTokens)}
                        </td>
                        <td className="border-b border-border px-2.5 py-2 text-right">
                          {formatUsd(summary.metered.costUsd)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-col md:hidden">
                {rows.map(({ date, summary }) => (
                  <div
                    key={date.getTime()}
                    className="flex items-center justify-between gap-2.5 border-b border-border py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0 text-[0.8125rem]">
                      {dayLabel(date, daily)}
                      <span className="block text-[0.6875rem] tabular-nums text-muted">
                        {summary.metered.calls}回 ／ 入力{" "}
                        {formatTokens(promptTokens(summary.metered))} ・ 出力{" "}
                        {formatTokens(summary.metered.outputTokens)}
                      </span>
                    </div>
                    <b className="text-sm tabular-nums">{formatUsd(summary.metered.costUsd)}</b>
                  </div>
                ))}
              </div>
            </section>

            <p className="text-[0.6875rem] leading-relaxed text-muted">
              <b className="font-medium text-foreground">
                費用はこのアプリが数えたトークン数からの概算で、Anthropicの請求額そのものでは
                ありません。
              </b>
              {pricingNote(total.metered.models)}
              円は1ドル={USD_JPY_RATE}円で換算した参考値です。
              「入力トークン」には、同じ内容を送り直さずに済ませたキャッシュ読みのぶんも
              含みます。<Code>pause_turn</Code> で頼み直した回は、その回数ぶん行が増えます。
              相談がCodexへ移る前（#128より古い記録）のぶんも、単価が付くためこの節に入っています。
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/** 注記の中で識別子を出すための小さな囲い。本文と同じ大きさだと読点に埋もれる。 */
function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-rail-active px-1 py-px font-mono text-[0.625rem] text-foreground">
      {children}
    </code>
  );
}

/** 節の見出し。左に「何のぶんか」、右に課金の形。 */
function BandHead({
  title,
  source,
  badge,
  accented = false,
}: {
  title: string;
  source: string;
  badge: string;
  accented?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex flex-wrap items-baseline gap-2 text-[0.8125rem] font-bold">
        {title}
        <span className="text-[0.6875rem] font-normal text-muted">{source}</span>
      </h2>
      <span
        className={cn(
          "whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.6875rem] font-bold",
          accented ? "bg-accent-surface text-accent" : "bg-rail-active text-muted",
        )}
      >
        {badge}
      </span>
    </div>
  );
}

function PanelHead({ title, withLegend = false }: { title: string; withLegend?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-[0.8125rem] font-bold">{title}</h3>
      {withLegend && (
        <div className="flex gap-3 text-[0.6875rem] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[3px] bg-accent/40" aria-hidden="true" />
            入力
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-2.5 rounded-[3px] bg-accent" aria-hidden="true" />
            出力
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * いま選んでいるモデルの注記（#71）。
 *
 * 「話す」と「書く」で同じモデルを選んでいるときは、モードの名前を出さず1つにまとめる。
 * 既定のまま使っている人にとって、分かれている事実はここでは要らない情報になる。
 *
 * **単価は書かない。** 定額制の節に出す文言で、Codexのモデルにトークン単価は無い。
 */
function selectedModelsNote(chatModels: { label: string; model: string }[]): string {
  const unique = Array.from(new Set(chatModels.map((entry) => entry.model)));

  if (unique.length === 0) return "";
  if (unique.length === 1) return ` いま選んでいる相談のモデルは ${unique[0]} です。`;

  return ` いま選んでいる相談のモデルは${chatModels
    .map((entry) => `${entry.label}が ${entry.model}`)
    .join("、")}です。`;
}

/**
 * 単価の注記（#71・#133）。
 *
 * **見るのは「これから使うモデル」ではなく、この集計に実際に入っているモデル**（`models`）。
 * 単価はモデルごとに違い、切り替えた前後の記録が同じ期間に混ざるため、選択中のモデルだけを
 * 書くと注記が集計と食い違う。
 *
 * 単価表に無いモデルは、`estimateCostUsd()` が既定の単価で概算する（#51）。名前を挙げても
 * 出せる単価が無いので、その旨だけを添える。
 */
function pricingNote(models: string[]): string {
  const priced = models.filter((model) => MODEL_PRICING[model]);

  const describe = (model: string) => {
    const pricing = MODEL_PRICING[model]!;
    return `${model}（入力 $${pricing.input} / 出力 $${pricing.output} / キャッシュ読み $${pricing.cacheRead} per 1M tokens）`;
  };

  const pricedNote = priced.length === 0 ? "" : `単価は ${priced.map(describe).join("、")}。`;

  return priced.length < models.length
    ? `${pricedNote}単価表に無いモデルのぶんは、いちばん高いモデルの単価で概算しています。`
    : pricedNote;
}

/** 定額制の節のカード。大きく出すのは費用ではなく回数。 */
function VolumeCard({
  label,
  summary,
  highlighted = false,
}: {
  label: string;
  summary: UsageSummary;
  highlighted?: boolean;
}) {
  return (
    <Card label={label} highlighted={highlighted} summary={summary}>
      <div className="flex items-baseline gap-2 tabular-nums">
        <b className="text-[1.625rem] font-bold leading-tight tracking-tight">{summary.calls}</b>
        <span className="text-[0.8125rem] text-muted">回</span>
      </div>
    </Card>
  );
}

/** 従量課金の節のカード。大きく出すのは概算費用。 */
function MoneyCard({
  label,
  summary,
  highlighted = false,
}: {
  label: string;
  summary: UsageSummary;
  highlighted?: boolean;
}) {
  return (
    <Card label={label} highlighted={highlighted} summary={summary} withCalls>
      <div className="flex items-baseline gap-2 tabular-nums">
        <b className="text-[1.625rem] font-bold leading-tight tracking-tight">
          {formatUsd(summary.costUsd)}
        </b>
        <span className="text-[0.8125rem] text-muted">{formatJpy(summary.costUsd)}</span>
      </div>
    </Card>
  );
}

function Card({
  label,
  summary,
  highlighted,
  withCalls = false,
  children,
}: {
  label: string;
  summary: UsageSummary;
  highlighted: boolean;
  withCalls?: boolean;
  children: ReactNode;
}) {
  const inputShare = tokenShare(summary);

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3.5",
        highlighted && "border-accent/45 bg-accent-surface",
      )}
    >
      <div className="text-[0.6875rem] font-bold tracking-[0.1em] text-muted">{label}</div>
      {children}
      <div className="text-xs tabular-nums text-muted">
        {withCalls && `${summary.calls}回 ／ `}入力 {formatTokens(promptTokens(summary))} ・ 出力{" "}
        {formatTokens(summary.outputTokens)}
      </div>
      {/* キャッシュ読みは入力の一部。効いていない期間に0を並べても読む理由が無いので、
          実際に読めたときだけ出す（#56）。 */}
      {summary.cacheReadTokens > 0 && (
        <div className="text-[0.6875rem] tabular-nums text-muted">
          入力のうち {formatTokens(summary.cacheReadTokens)} はキャッシュから
        </div>
      )}
      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-rail-active">
        <i className="block h-full bg-accent/40" style={{ width: `${inputShare}%` }} />
        <i className="block h-full bg-accent" style={{ width: `${100 - inputShare}%` }} />
      </div>
    </div>
  );
}

/**
 * 日別の棒グラフ。1日ぶんの棒を、入力と出力の比で塗り分ける。
 *
 * 目盛りは置かず、いちばん高い日を基準にした相対の高さだけを見せる。定額制の節では棒の高さが
 * トークン量、従量課金の節では概算費用になる（数字そのものは節ごとの表とカードにある）。
 */
function DailyChart({
  daily,
  value,
  band,
}: {
  daily: DailyUsage[];
  value: (summary: UsageSummary) => number;
  band: "subscription" | "metered";
}) {
  const pick = (day: DailyUsage) => day.summary[band];
  const max = Math.max(...daily.map((day) => value(pick(day))), 0);

  return (
    <div className="flex h-[110px] items-end gap-1 overflow-x-auto pt-1 md:h-[130px] md:gap-1.5">
      {daily.map((day, index) => {
        const summary = pick(day);
        const amount = value(summary);
        const isToday = index === daily.length - 1;
        // 使った日が「使っていない日」と同じ見た目にならないよう、下限を持たせる。
        const height = max > 0 && amount > 0 ? Math.max(4, (amount / max) * 100) : 0;
        const inputShare = tokenShare(summary);

        return (
          <div
            key={day.date.getTime()}
            className="flex h-full min-w-[14px] flex-1 flex-col items-center justify-end gap-1.5"
            title={`${day.date.getMonth() + 1}/${day.date.getDate()} ${
              band === "metered"
                ? formatUsd(summary.costUsd)
                : `${formatTokens(totalTokens(summary))} tokens`
            }`}
          >
            <div
              className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-rail-active"
              style={{ height: `${height}%` }}
            >
              <i className="block w-full bg-accent" style={{ height: `${100 - inputShare}%` }} />
              <i className="block w-full bg-accent/40" style={{ height: `${inputShare}%` }} />
            </div>
            <span
              className={cn(
                "whitespace-nowrap text-[0.625rem] tabular-nums text-muted",
                isToday && "font-bold text-accent",
              )}
            >
              {isToday ? "今日" : shortDayLabel(day.date, index === 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 入力・出力を合わせたトークン数。定額制の節では、これが棒の高さになる。 */
function totalTokens(summary: UsageSummary): number {
  return promptTokens(summary) + summary.outputTokens;
}

/**
 * 入力ぶんのトークンが全体に占める割合（%）。塗り分けにだけ使う。
 *
 * キャッシュから読んだぶんも入力として数える（#56）。`inputTokens` はキャッシュに載らなかった
 * 残りだけなので、これを外すと入力の棒が実態よりはるかに細くなる。
 */
function tokenShare(summary: UsageSummary): number {
  const tokens = totalTokens(summary);
  if (tokens === 0) return 100;
  return Math.round((promptTokens(summary) / tokens) * 100);
}

function shortDayLabel(date: Date, withMonth: boolean): string {
  return withMonth || date.getDate() === 1
    ? `${date.getMonth() + 1}/${date.getDate()}`
    : `${date.getDate()}`;
}

function dayLabel(date: Date, daily: DailyUsage[]): string {
  const label = `${date.getMonth() + 1}/${date.getDate()}`;
  const today = daily[daily.length - 1]?.date;
  return today && today.getTime() === date.getTime() ? `${label}（今日）` : label;
}
