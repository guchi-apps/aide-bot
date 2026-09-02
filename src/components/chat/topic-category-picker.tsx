"use client";

import { Check, CircleAlert } from "lucide-react";
import { useState } from "react";

import { TOPIC_CATEGORIES, type TopicCategoryId } from "@/lib/topic-categories";
import { cn } from "@/lib/utils";

/**
 * 話題（#144）として仕入れるニュースの種類を選ぶ。
 *
 * 設定の画面ではなく「話題」ページに置いてある。仕入れた結果のすぐ上にある方が、種類を変えた
 * 効果が見える。保存はDB（`PATCH /api/settings/topics`）で、`BriefingTimePicker` と同じ形。
 */

type Props = {
  /** サーバー側でDBから読んだ、いまの設定。 */
  initial: TopicCategoryId[];
};

export function TopicCategoryPicker({ initial }: Props) {
  const [chosen, setChosen] = useState<Set<TopicCategoryId>>(new Set(initial));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const toggle = async (id: TopicCategoryId) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/topics", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: [...next] }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "保存できませんでした。");
      }

      setMessage({
        tone: "info",
        text: next.size === 0 ? "仕入れを止めました" : "保存しました。次の仕入れから反映されます",
      });
    } catch (error) {
      // 保存できなかったので、画面の状態を元へ戻す。
      setChosen(chosen);
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "保存できませんでした。",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
        {TOPIC_CATEGORIES.map((category) => {
          const on = chosen.has(category.id);
          return (
            <button
              key={category.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={saving}
              onClick={() => void toggle(category.id)}
              className={cn(
                "flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60",
                on ? "border-accent/45 bg-accent-surface" : "border-border bg-surface hover:bg-rail-active",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px]",
                  on ? "border-accent bg-accent text-accent-foreground" : "border-muted bg-surface",
                )}
              >
                {on && <Check className="size-3" strokeWidth={3} />}
              </span>
              <span>
                <b className="block text-[0.8125rem] font-semibold">{category.label}</b>
                <span className="block text-[0.6875rem] leading-relaxed text-muted">{category.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[0.6875rem] leading-relaxed text-muted">
        <b className="font-medium text-foreground">すべて外すと仕入れを止めます。</b>
        仕入れは相談と同じChatGPTのサブスク枠で動き、費用は付きません（使った量は「使用量」に出ます）。
      </p>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium",
            message.tone === "error" ? "text-danger" : "text-accent",
          )}
        >
          {message.tone === "error" && <CircleAlert className="size-3.5" aria-hidden="true" />}
          {message.text}
        </p>
      )}
    </div>
  );
}
