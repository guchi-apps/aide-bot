"use client";

import { CalendarClock, CircleAlert, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import {
  SCHEDULED_PUSH_LIMIT,
  WEEKDAYS,
  maskToDays,
  daysToMask,
  SCHEDULED_PUSH_ALL,
} from "@/lib/scheduled-push-rule";
import type { TopicCategory } from "@/lib/topic-categories";
import { cn } from "@/lib/utils";

/**
 * 定時のお知らせ（#344）。曜日・時刻（30分刻み）・話題の種類を指定して、溜めてある話題を通知で届ける。
 * 読むのはcronの経路なのでDBに保存する。通知の購読（上の「お知らせ」）が前提。
 */

export type ScheduleRow = {
  id: string;
  daysMask: number;
  hour: number;
  minute: number;
  category: string;
  enabled: boolean;
};

/** 選べる種類。削除された種類を指したままの行は、その行にだけ「（削除された種類）」を足す。 */
function categoryOptions(categories: TopicCategory[], current: string): { value: string; label: string }[] {
  const options = [
    { value: SCHEDULED_PUSH_ALL, label: "すべての話題" },
    ...categories.map((category) => ({ value: category.id, label: category.label })),
  ];
  if (!options.some((option) => option.value === current)) options.push({ value: current, label: "（削除された種類）" });
  return options;
}

const TIMES = Array.from({ length: 48 }, (_, index) => ({ hour: Math.floor(index / 2), minute: (index % 2) * 30 }));

function timeLabel(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

const selectClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold disabled:opacity-50";

type Props = { initial: ScheduleRow[]; hasDevice: boolean; categories: TopicCategory[] };

export function ScheduledPushSettingsCard({ initial, hasDevice, categories }: Props) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function call(method: string, body: unknown): Promise<Response | null> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/settings/scheduled-push", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(error.error ?? "保存できませんでした。");
        return null;
      }
      return response;
    } catch {
      setMessage("保存できませんでした。");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    // 初期値は「平日の朝7:00・すべての話題」。作ってから画面で直す。
    const response = await call("POST", { days: [1, 2, 3, 4, 5], hour: 7, minute: 0, category: SCHEDULED_PUSH_ALL });
    if (!response) return;
    const { schedule } = (await response.json()) as { schedule: ScheduleRow };
    setRows((current) => [...current, schedule]);
  }

  async function patch(id: string, change: Partial<Omit<ScheduleRow, "id">> & { days?: number[] }) {
    const { days, ...rest } = change;
    const response = await call("PATCH", { id, ...rest, ...(days ? { days } : {}) });
    if (!response) return;
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...rest, ...(days ? { daysMask: daysToMask(days) } : {}) } : row)),
    );
  }

  async function remove(id: string) {
    const response = await call("DELETE", { id });
    if (response) setRows((current) => current.filter((row) => row.id !== id));
  }

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">定時のお知らせ</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          決めた曜日・時刻に、溜めてある話題（ニュース）の見出しを通知でお届けします。話題は「話題」ページで
          選んだ種類から仕入れたものを使い、24時間より古いものは送りません。届ける話題が無い日は通知しません。
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-surface text-accent">
            <CalendarClock className="size-[22px]" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-muted">
            時刻は30分刻みです。設定した時刻を過ぎた最初の確認（30分ごと）で届きます。
          </p>
        </div>

        {rows.length === 0 && <p className="text-xs text-muted">まだ登録がありません。</p>}

        {rows.map((row) => {
          const days = maskToDays(row.daysMask);
          return (
            <div key={row.id} className={cn("flex flex-col gap-3 rounded-lg border border-border px-4 py-3", !row.enabled && "opacity-60")}>
              <fieldset className="flex flex-wrap gap-1.5" disabled={busy}>
                <legend className="sr-only">曜日</legend>
                {WEEKDAYS.map((name, day) => {
                  const on = days.includes(day);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const next = on ? days.filter((value) => value !== day) : [...days, day];
                        if (next.length > 0) void patch(row.id, { days: next });
                      }}
                      className={cn(
                        "size-9 rounded-full border text-sm font-medium",
                        on ? "border-accent bg-accent-surface text-accent" : "border-border text-muted",
                      )}
                    >
                      {name}
                    </button>
                  );
                })}
              </fieldset>

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  aria-label="時刻"
                  className={cn(selectClass, "tabular-nums")}
                  disabled={busy}
                  value={timeLabel(row.hour, row.minute)}
                  onChange={(event) => {
                    const [hour, minute] = event.target.value.split(":").map(Number);
                    void patch(row.id, { hour, minute });
                  }}
                >
                  {TIMES.map(({ hour, minute }) => (
                    <option key={timeLabel(hour, minute)} value={timeLabel(hour, minute)}>
                      {timeLabel(hour, minute)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="話題の種類"
                  className={selectClass}
                  disabled={busy}
                  value={row.category}
                  onChange={(event) => void patch(row.id, { category: event.target.value })}
                >
                  {categoryOptions(categories, row.category).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={row.enabled}
                    disabled={busy}
                    onChange={(event) => void patch(row.id, { enabled: event.target.checked })}
                  />
                  有効
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(row.id)}
                  aria-label="この設定を削除"
                  className="ml-auto grid size-9 place-items-center rounded-lg text-muted hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          );
        })}

        <div>
          <button
            type="button"
            disabled={busy || rows.length >= SCHEDULED_PUSH_LIMIT}
            onClick={() => void add()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="size-4" aria-hidden="true" />
            定時のお知らせを追加
          </button>
        </div>

        {message && (
          <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            {message}
          </p>
        )}

        {!hasDevice && (
          <p className="rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            通知を受け取る端末がまだ登録されていません。上の「お知らせ」で通知をオンにすると届くようになります。
          </p>
        )}
      </div>
    </section>
  );
}
