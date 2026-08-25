import { MODEL_PRICING } from "@/lib/chat-model";
import {
  USD_JPY_RATE,
  formatJpy,
  formatTokens,
  formatUsd,
  promptTokens,
  type DailyUsage,
  type UsageSummary,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

type Props = {
  today: UsageSummary;
  month: UsageSummary;
  total: UsageSummary;
  /** 古い日から新しい日の順。最後の要素が今日。 */
  daily: DailyUsage[];
  /** 表に出す日数（日別グラフより短くする）。 */
  tableDays: number;
  /** 「8月」のような、今月を指す文言。サーバー側で作って渡す。 */
  monthLabel: string;
  /**
   * いま選んでいるモデル（#71）。単価の注記に出す。
   *
   * 「話す」と「書く」で別々に選べるため複数入る。ここに出るのは**これから使う**モデルで、
   * 上の集計はどれも呼び出した時点のモデルの単価で足し上げてある。
   */
  chatModels: { label: string; model: string }[];
};

/**
 * 使用量の画面（#51）。
 *
 * サーバーコンポーネントのまま置いている。数字を見るだけで操作が無く、クライアントにすると
 * `@/lib/usage`（PrismaとAnthropic SDKを引き込む）がバンドルへ入るため。
 */
export function UsageView({ today, month, total, daily, tableDays, monthLabel, chatModels }: Props) {
  const rows = daily.slice(-tableDays).reverse();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <div className="grid gap-2.5 md:grid-cols-3 md:gap-3">
          <SummaryCard label={`今月（${monthLabel}）`} summary={month} highlighted />
          <SummaryCard label="今日" summary={today} />
          <SummaryCard label="累計" summary={total} />
        </div>

        {total.calls === 0 && (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            まだ記録がありません。相談を送ると、その往復で使ったぶんがここに出ます。
          </p>
        )}

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-[0.8125rem] font-bold">日別の概算費用（直近{daily.length}日）</h2>
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
          </div>
          <DailyChart daily={daily} />
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="text-[0.8125rem] font-bold">日別の内訳（直近{rows.length}日）</h2>

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
                      {summary.calls}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-right">
                      {formatTokens(promptTokens(summary))}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-right text-muted">
                      {formatTokens(summary.cacheReadTokens)}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-right">
                      {formatTokens(summary.outputTokens)}
                    </td>
                    <td className="border-b border-border px-2.5 py-2 text-right">
                      {formatUsd(summary.costUsd)}
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
                    {summary.calls}回 ／ 入力 {formatTokens(promptTokens(summary))} ・ 出力{" "}
                    {formatTokens(summary.outputTokens)}
                  </span>
                </div>
                <b className="text-sm tabular-nums">{formatUsd(summary.costUsd)}</b>
              </div>
            ))}
          </div>

          <p className="text-[0.6875rem] leading-relaxed text-muted">
            <b className="font-medium text-foreground">
              費用はこのアプリが数えたトークン数からの概算で、Anthropicの請求額そのものでは
              ありません。
            </b>
            {pricingNote(chatModels)}
            円は1ドル={USD_JPY_RATE}円で換算した参考値です。
            「入力トークン」には、同じ内容を送り直さずに済ませたキャッシュ読みのぶんも
            含みます。 この機能を入れる前の相談は記録が無いため入っていません。途中で遮った
            往復は、出力ぶんが実際より少なく記録されます。
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * 単価の注記（#71）。
 *
 * 「話す」と「書く」で同じモデルを選んでいるときは、モードの名前を出さず1つにまとめる。
 * 既定のまま使っている人にとって、分かれている事実はここでは要らない情報になる。
 */
function pricingNote(chatModels: { label: string; model: string }[]): string {
  const unique = Array.from(new Set(chatModels.map((entry) => entry.model)));

  const describe = (model: string) => {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return model;
    return `${model}（入力 $${pricing.input} / 出力 $${pricing.output} / キャッシュ読み $${pricing.cacheRead} per 1M tokens）`;
  };

  if (unique.length <= 1) {
    return unique.length === 0 ? "" : `単価は ${describe(unique[0])}。`;
  }

  return `単価は${chatModels.map((entry) => `${entry.label}が ${describe(entry.model)}`).join("、")}。`;
}

function SummaryCard({
  label,
  summary,
  highlighted = false,
}: {
  label: string;
  summary: UsageSummary;
  highlighted?: boolean;
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
      <div className="flex items-baseline gap-2 tabular-nums">
        <b className="text-[1.625rem] font-bold leading-tight tracking-tight">
          {formatUsd(summary.costUsd)}
        </b>
        <span className="text-[0.8125rem] text-muted">{formatJpy(summary.costUsd)}</span>
      </div>
      <div className="text-xs tabular-nums text-muted">
        {summary.calls}回 ／ 入力 {formatTokens(promptTokens(summary))} ・ 出力{" "}
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
 * 日別の棒グラフ。1日ぶんの棒を、入力と出力の費用の比で塗り分ける。
 *
 * 目盛りは置かず、いちばん高い日を基準にした相対の高さだけを見せる。金額そのものは
 * すぐ下の表にあり、細い棒に数字を添えると読めなくなるため。
 */
function DailyChart({ daily }: { daily: DailyUsage[] }) {
  const max = Math.max(...daily.map((day) => day.summary.costUsd), 0);

  return (
    <div className="flex h-[110px] items-end gap-1 overflow-x-auto pt-1 md:h-[130px] md:gap-1.5">
      {daily.map(({ date, summary }, index) => {
        const isToday = index === daily.length - 1;
        // 使った日が「使っていない日」と同じ見た目にならないよう、下限を持たせる。
        const height = max > 0 && summary.costUsd > 0 ? Math.max(4, (summary.costUsd / max) * 100) : 0;
        const inputShare = tokenShare(summary);

        return (
          <div
            key={date.getTime()}
            className="flex h-full min-w-[14px] flex-1 flex-col items-center justify-end gap-1.5"
            title={`${date.getMonth() + 1}/${date.getDate()} ${formatUsd(summary.costUsd)}`}
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
              {isToday ? "今日" : shortDayLabel(date, index === 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 入力ぶんのトークンが全体に占める割合（%）。塗り分けにだけ使う。
 *
 * キャッシュから読んだぶんも入力として数える（#56）。`inputTokens` はキャッシュに載らなかった
 * 残りだけなので、これを外すと入力の棒が実態よりはるかに細くなる。
 */
function tokenShare(summary: UsageSummary): number {
  const input = promptTokens(summary);
  const tokens = input + summary.outputTokens;
  if (tokens === 0) return 100;
  return Math.round((input / tokens) * 100);
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
