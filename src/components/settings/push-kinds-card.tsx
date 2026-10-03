"use client";

import { CircleAlert } from "lucide-react";
import { useCallback, useState } from "react";

import { PUSH_KINDS, PUSH_KIND_INFO, type PushKind } from "@/lib/push/kinds";
import { cn } from "@/lib/utils";

/**
 * 通知の種類ごとのオン・オフと、種類別のテスト送信（#488）。
 *
 * オフにした種類は、生成も送信もしない（サーバー側で止める。`src/lib/push/kinds-server.ts`）。
 * 試し送信は種類がオフでも送れる——確かめたいのは「その形で届くか」だから。
 * 端末の登録（上の「この端末で受け取る」）とは別で、ここは利用者単位の設定。
 */

type Props = { initialDisabled: PushKind[] };

type Message = { tone: "info" | "error"; text: string; kind?: PushKind };

export function PushKindsCard({ initialDisabled }: Props) {
  const [disabled, setDisabled] = useState<Set<PushKind>>(() => new Set(initialDisabled));
  const [busy, setBusy] = useState<PushKind | "all" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const toggle = useCallback(async (kind: PushKind, enabled: boolean) => {
    // 先に画面へ反映し、失敗したら戻す（連打で結果が前後しないよう、保存中は同じ種類を触らせない）
    setDisabled((current) => {
      const next = new Set(current);
      if (enabled) next.delete(kind);
      else next.add(kind);
      return next;
    });
    setMessage(null);

    try {
      const response = await fetch("/api/settings/push-kinds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [kind]: enabled }),
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(error.error ?? "保存できませんでした。");
      }
    } catch (error) {
      setDisabled((current) => {
        const next = new Set(current);
        if (enabled) next.add(kind);
        else next.delete(kind);
        return next;
      });
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "保存できませんでした。" });
    }
  }, []);

  const sendTests = useCallback(async (kinds: readonly PushKind[]) => {
    setBusy(kinds.length === 1 ? kinds[0] : "all");
    setMessage(null);

    try {
      let delivered = 0;
      for (const kind of kinds) {
        const response = await fetch("/api/push/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        const result = (await response.json().catch(() => ({}))) as { delivered?: number; error?: string };
        if (!response.ok) throw new Error(result.error ?? "テスト通知を送れませんでした。");
        delivered = Math.max(delivered, result.delivered ?? 0);
      }

      setMessage(
        delivered > 0
          ? {
              tone: "info",
              text: `${delivered}台へ送りました。数秒で届きます。`,
              kind: kinds.length === 1 ? kinds[0] : undefined,
            }
          : {
              tone: "error",
              text: "送り先が1台もありませんでした。上の「この端末で受け取る」をオンにしてください。",
            },
      );
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "テスト通知を送れませんでした。",
      });
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">通知の種類</h3>
          <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
            オフにした種類は作成も送信もしません。
          </p>
        </div>
        <button
          type="button"
          onClick={() => sendTests(PUSH_KINDS)}
          disabled={busy !== null}
          className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy === "all" ? "送っています…" : "すべてテスト送信"}
        </button>
      </header>

      <ul className="overflow-hidden rounded-xl border border-border bg-surface">
        {PUSH_KINDS.map((kind) => {
          const info = PUSH_KIND_INFO[kind];
          const enabled = !disabled.has(kind);

          return (
            <li
              key={kind}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-4 py-3.5 first:border-t-0"
            >
              <div className={cn("min-w-0 flex-1 basis-56", !enabled && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {info.label}
                  {!enabled && (
                    <span className="rounded-full bg-accent-surface px-1.5 text-[0.625rem] font-normal text-accent">
                      オフ
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{info.hint}</p>
                <p className="mt-0.5 text-[0.6875rem] text-muted">{info.when}</p>
                {message?.kind === kind && message.tone === "info" && (
                  <span role="status" className="mt-1 block text-[0.6875rem] text-accent">
                    ✓ {message.text}
                  </span>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => sendTests([kind])}
                  disabled={busy !== null}
                  className="whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active disabled:opacity-50"
                >
                  {busy === kind ? "送っています…" : "試しに送る"}
                </button>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  aria-label={`${info.label}の通知`}
                  onClick={() => toggle(kind, !enabled)}
                  className={cn(
                    "relative h-6 w-[42px] shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                    enabled ? "bg-accent" : "bg-border",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-[3px] top-[3px] size-[18px] rounded-full bg-white shadow transition-transform",
                      enabled && "translate-x-[18px]",
                    )}
                  />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {message && !(message.tone === "info" && message.kind) && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-start gap-2 rounded-xl border px-4 py-2.5 text-sm leading-relaxed",
            message.tone === "error"
              ? "border-danger/30 bg-danger-surface text-danger"
              : "border-accent/30 bg-accent-surface",
          )}
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{message.text}</span>
        </p>
      )}

      <p className="text-xs leading-relaxed text-muted">
        「試しに送る」は、その種類と同じ見出しの見本を、登録済みの全端末へ送ります。種類がオフでも送れます。
      </p>
    </section>
  );
}
