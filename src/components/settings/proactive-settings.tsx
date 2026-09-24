"use client";

import { CircleAlert, Sparkles } from "lucide-react";
import { useCallback, useState } from "react";

import {
  PROACTIVE_FREQUENCIES,
  PROACTIVE_FREQUENCY_LABELS,
  type ProactiveFrequency,
  type ProactiveSettings,
} from "@/lib/proactive-labels";
import { cn } from "@/lib/utils";

/**
 * 先回りの提案（#325）の設定。種類ごとのオン・オフ・静かな時間帯・頻度。
 *
 * **通知の購読そのもの（上の「お知らせ」）とは別。** ここを全部切っても、会話からの提案（#324）は
 * 使える。DBに保存するのは、読むのがcronから叩かれる経路でCookieが届かないため。
 */

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}

type Props = { initial: ProactiveSettings; hasDevice: boolean };

export function ProactiveSettingsCard({ initial, hasDevice }: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const update = useCallback(async (patch: Partial<ProactiveSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/proactive", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "保存できませんでした。");
      }

      setMessage({ tone: "info", text: "保存しました" });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "保存できませんでした。" });
    } finally {
      setSaving(false);
    }
  }, []);

  const kinds = [
    { key: "weekend", label: "週末の空きと、やりたいこと", hint: "金曜の勤務後・土曜に、まとまった空きへ合う希望を" },
    { key: "freeTime", label: "予定の変更でできた空き時間", hint: "キャンセルや変更で空いた時間を" },
    { key: "ongoing", label: "未完了の用件に着手しやすい時間", hint: "やり残しのタスクに手を付けやすい時間を" },
  ] as const;

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">先回りの提案</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          予定・タスク・Notionの「いつかやりたいこと」を見て、「今ならできる」ことを秘書から通知でお伝えします。
          押すと会話が開き、そのときの予定や希望を読み直して続きを相談できます。提案するだけで、予定やタスクは
          あなたが頼むまで書き換えません。
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-surface text-accent">
            <Sparkles className="size-[22px]" aria-hidden="true" />
          </span>
          <p className="text-xs leading-relaxed text-muted">
            平日の勤務・通勤の時間帯と静かな時間帯には送りません。上の通知をオフにしても、会話からの提案は使えます。
          </p>
        </div>

        <fieldset className="flex flex-col gap-2.5" disabled={saving}>
          <legend className="sr-only">提案の種類</legend>
          {kinds.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={settings[key]}
                onChange={(event) => void update({ [key]: event.target.checked })}
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2.5 text-sm">
          <span className="text-xs font-medium text-muted">静かな時間帯</span>
          <select
            aria-label="静かな時間帯の開始"
            value={settings.quietStart}
            disabled={saving}
            onChange={(event) => void update({ quietStart: Number(event.target.value) })}
            className="rounded-lg border border-border bg-background px-3 py-2 font-semibold tabular-nums disabled:opacity-50"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {pad(hour)}時
              </option>
            ))}
          </select>
          <span className="font-bold text-muted">〜</span>
          <select
            aria-label="静かな時間帯の終了"
            value={settings.quietEnd}
            disabled={saving}
            onChange={(event) => void update({ quietEnd: Number(event.target.value) })}
            className="rounded-lg border border-border bg-background px-3 py-2 font-semibold tabular-nums disabled:opacity-50"
          >
            {HOURS.map((hour) => (
              <option key={hour} value={hour}>
                {pad(hour)}時
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={settings.avoidWork}
            disabled={saving}
            onChange={(event) => void update({ avoidWork: event.target.checked })}
          />
          平日の勤務・通勤の時間帯（8:00〜19:00）を避ける
        </label>

        <div className="flex items-center gap-2.5 text-sm">
          <span className="text-xs font-medium text-muted">頻度</span>
          <select
            aria-label="頻度"
            value={settings.frequency}
            disabled={saving}
            onChange={(event) => void update({ frequency: event.target.value as ProactiveFrequency })}
            className="rounded-lg border border-border bg-background px-3 py-2 font-semibold disabled:opacity-50"
          >
            {PROACTIVE_FREQUENCIES.map((value) => (
              <option key={value} value={value}>
                {PROACTIVE_FREQUENCY_LABELS[value]}
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

        {!hasDevice && (
          <p className="rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            通知を受け取る端末がまだ登録されていません。上の「お知らせ」で通知をオンにすると届くようになります。
          </p>
        )}
      </div>
    </section>
  );
}
