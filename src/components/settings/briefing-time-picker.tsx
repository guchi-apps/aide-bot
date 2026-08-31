"use client";

import { AlarmClock, CircleAlert } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 朝の見通し（#79）を届ける時刻を選ぶ（#121）。
 *
 * **DBに保存する。** Cookie（`ModelPicker` 等）にしないのは、この設定を読むのが
 * cronから叩かれる利用者のいない経路（`src/lib/briefing.ts`）で、そこにはCookieが
 * 届かないため（`BRIEFING_MODEL` がCookieを読まないのと同じ理由）。
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 30] as const;

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

type Props = {
  /** サーバー側でDBから読んだ、いまの設定。 */
  initial: { hour: number; minute: number };
};

export function BriefingTimePicker({ initial }: Props) {
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const save = useCallback(async (nextHour: number, nextMinute: number) => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/briefing-time", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hour: nextHour, minute: nextMinute }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "保存できませんでした。");
      }

      setMessage({ tone: "info", text: `${pad(nextHour)}:${pad(nextMinute)}に保存しました` });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "保存できませんでした。",
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const changeHour = useCallback(
    (value: number) => {
      setHour(value);
      void save(value, minute);
    },
    [minute, save],
  );

  const changeMinute = useCallback(
    (value: number) => {
      setMinute(value);
      void save(hour, value);
    },
    [hour, save],
  );

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">お知らせの時間</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          朝のお知らせを届ける時刻です。時刻を変えると、次の朝からその時刻を基準に届きます。
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-surface text-accent">
            <AlarmClock className="size-[22px]" aria-hidden="true" />
          </span>

          <div>
            <div className="font-mono text-[2rem] font-bold leading-none tabular-nums">
              {pad(hour)}
              <span className="text-accent">:</span>
              {pad(minute)}
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-muted">日本時間・毎朝</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            aria-label="時"
            value={hour}
            disabled={saving}
            onChange={(event) => changeHour(Number(event.target.value))}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold tabular-nums disabled:opacity-50"
          >
            {HOURS.map((value) => (
              <option key={value} value={value}>
                {pad(value)}時
              </option>
            ))}
          </select>

          <span className="font-bold text-muted">:</span>

          <select
            aria-label="分"
            value={minute}
            disabled={saving}
            onChange={(event) => changeMinute(Number(event.target.value))}
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold tabular-nums disabled:opacity-50"
          >
            {MINUTES.map((value) => (
              <option key={value} value={value}>
                {pad(value)}分
              </option>
            ))}
          </select>
        </div>

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              message.tone === "error" ? "text-danger" : "text-accent",
            )}
          >
            {message.tone === "error" && <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />}
            {message.text}
          </p>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          実際に届く時刻は、選んだ時刻から最大15分ほど前後することがあります。
        </p>
      </div>
    </section>
  );
}
