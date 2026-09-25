"use client";

import { useState } from "react";

import { describeChange, type SettingsChange } from "@/lib/settings-proposal";

type State = "idle" | "applying" | "applied" | "dismissed" | "failed";

/**
 * 秘書が出した設定の変更案（#346）。**押すまで何も変わらない**。反映は
 * `POST /api/settings/actions` が検証し直して行う。再読み込みすると押す前の見た目に戻るが、
 * 同じ値を書くだけなので何度押しても同じ結果になる。
 */
export function SettingsProposalCard({ changes }: { changes: SettingsChange[] }) {
  const [state, setState] = useState<State>("idle");
  const rows = changes.flatMap(describeChange);

  async function apply() {
    setState("applying");
    try {
      const response = await fetch("/api/settings/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes }),
      });
      setState(response.ok ? "applied" : "failed");
    } catch {
      setState("failed");
    }
  }

  return (
    <div className="mt-3 flex w-full max-w-md flex-col gap-3 rounded-xl border border-accent/60 bg-surface p-3.5 text-sm">
      <div className="flex items-center justify-between gap-2 font-bold">
        設定の変更案
        <span className="rounded-full border border-accent/60 px-2 text-[0.6875rem] font-medium text-accent">
          {state === "applied" ? "変更しました" : state === "dismissed" ? "見送りました" : "確認待ち"}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted">{row.label}</dt>
            <dd className="font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
      {(state === "idle" || state === "applying" || state === "failed") && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={state === "applying"}
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            {state === "applying" ? "変更しています…" : "変更する"}
          </button>
          <button
            type="button"
            onClick={() => setState("dismissed")}
            className="rounded-lg border border-border px-3.5 py-2 text-xs"
          >
            やめる
          </button>
          {state === "failed" && (
            <span role="alert" className="text-xs text-red-600">
              変更できませんでした。もう一度お試しください。
            </span>
          )}
        </div>
      )}
      <p className="text-[0.6875rem] text-muted">押すまでは何も変わりません。</p>
    </div>
  );
}
