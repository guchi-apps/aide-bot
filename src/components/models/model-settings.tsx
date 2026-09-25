"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  CHAT_MODELS,
  MODEL_USES,
  MODEL_USE_GROUP_LABELS,
  MODEL_USE_META,
  type ChatModelId,
  type ModelUse,
  type ModelUseGroup,
} from "@/lib/chat-model";
import { cn } from "@/lib/utils";

/**
 * 用途ごとのモデルを選ぶ（#349。旧・設定の「返答のモデル」#71・#128）。
 *
 * 選ぶとすぐ保存し、次の実行から効く。保存先は利用者ごとのDB（cronなどCookieの届かない経路でも
 * 同じ値を読むため）。失敗した回は選択を元へ戻して理由を出す。
 */

type Props = {
  initial: Record<ModelUse, ChatModelId>;
};

const GROUPS: ModelUseGroup[] = ["chat", "scheduled", "background"];

type Status = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

export function ModelSettings({ initial }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(initial);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const choose = useCallback(
    async (use: ModelUse, id: ChatModelId) => {
      const previous = selected[use];
      if (previous === id) return;

      setSelected((current) => ({ ...current, [use]: id }));
      setStatus({ kind: "idle" });

      try {
        const response = await fetch("/api/settings/models", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [use]: id }),
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(data?.error ?? "保存できませんでした。");
        }

        setStatus({ kind: "saved" });
        router.refresh();
      } catch (error) {
        setSelected((current) => ({ ...current, [use]: previous }));
        setStatus({ kind: "error", message: error instanceof Error ? error.message : "保存できませんでした。" });
      }
    },
    [router, selected],
  );

  return (
    <div className="flex flex-col gap-6">
      <header>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-medium">モデル</h2>
          <span
            role="status"
            className={cn("text-[0.6875rem]", status.kind === "error" ? "text-danger" : "text-muted")}
          >
            {status.kind === "saved" && "保存しました"}
            {status.kind === "error" && status.message}
            {status.kind === "idle" && "変更は自動で保存"}
          </span>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          用途ごとに使うモデルを選びます。賢いモデルほど、ChatGPTサブスクの利用枠が早く減ります。
        </p>
      </header>

      {GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h3 className="text-[0.6875rem] font-medium uppercase tracking-wider text-muted">
            {MODEL_USE_GROUP_LABELS[group]}
          </h3>

          {MODEL_USES.filter((use) => MODEL_USE_META[use].group === group).map((use) => {
            const meta = MODEL_USE_META[use];

            return (
              <fieldset
                key={use}
                className="grid gap-x-4 gap-y-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <legend className="sr-only">{meta.label}のモデル</legend>

                <div className="min-w-0" aria-hidden="true">
                  <b className="text-[0.84rem] font-semibold">{meta.label}</b>
                  <span className="block text-[0.72rem] leading-snug text-muted">{meta.hint}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {CHAT_MODELS.map((model) => {
                    const checked = selected[use] === model.id;

                    return (
                      <label
                        key={model.id}
                        className={cn(
                          "flex flex-1 cursor-pointer flex-col items-center whitespace-nowrap rounded-[9px] border border-border bg-background px-3 py-1.5 text-xs transition-colors hover:bg-rail-active sm:flex-none",
                          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                          checked && "border-accent bg-accent-surface font-bold shadow-[0_0_0_1px_var(--accent)]",
                        )}
                      >
                        <input
                          type="radio"
                          name={`model-${use}`}
                          value={model.id}
                          checked={checked}
                          onChange={() => void choose(use, model.id)}
                          className="sr-only"
                        />
                        {model.label}
                        <small className="text-[0.625rem] font-normal text-muted">{model.hint}</small>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}
    </div>
  );
}
