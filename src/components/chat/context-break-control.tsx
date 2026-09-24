"use client";

import { Scissors } from "lucide-react";
import { useState } from "react";

import { IDLE_BREAK_HOURS } from "@/lib/context-break-rule";

/**
 * 「会話を区切る」（#322）。入力欄の上に小さく置く。
 *
 * **履歴を削除する操作ではない**ことを、押す前に読める場所へ書く。押すと、以後の返答が
 * これまでの話題を引き継がなくなる（記録は消えず、左の日付から読める）。自動で区切る
 * 条件と、いまの会話がいつ始まったかもここから確かめられる。
 */
export function ContextBreakControl({
  contextSince,
  disabled,
  onBroke,
}: {
  /** いまの会話の始まり（`9月24日 07:00`）。区切っていなければnull。サーバーで確定させて渡す。 */
  contextSince: string | null;
  /** 返答の生成中は押させない（押した瞬間の返答がどちらの会話に入るか分かりにくいため）。 */
  disabled: boolean;
  /** 区切れたとき。区切った時刻（`07:00`）を渡す。 */
  onBroke: (time: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function breakContext() {
    setPending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/conversation/break", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));

      const result = (await response.json()) as { broke: boolean; time: string | null };
      if (result.broke && result.time) {
        onBroke(result.time);
        setOpen(false);
      } else {
        setMessage("いまの会話にはまだ発言がないため、区切る必要はありません。");
      }
    } catch {
      setMessage("区切れませんでした。少し待ってからもう一度お試しください。");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl text-xs text-muted">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 transition-colors hover:bg-rail-active"
      >
        <Scissors className="size-3" aria-hidden="true" />
        会話を区切る
      </button>

      {open && (
        <div className="mt-1.5 flex flex-col gap-2 rounded-xl border border-border bg-rail px-3.5 py-3 leading-relaxed">
          <p>
            区切ると、次の返答からこれまでの話題を引き継がずに新しい会話として始まります。
            <strong className="font-bold text-foreground">履歴は削除されません。</strong>
            これまでの記録は、左の日付からいつでも読み返せます。
          </p>
          <p>
            最後に話してから{IDLE_BREAK_HOURS}時間以上あき、日付が変わったあとに話しかけたときは、自動でも区切ります。
            日付をまたいで話し続けている間は区切りません。朝の見通しなど、秘書からの自動の発言では時間は延びません。
          </p>
          <p>
            いまの会話の始まり：{contextSince ?? "記録の最初から（まだ区切っていません）"}
          </p>
          {message && (
            <p role="status" className="text-foreground">
              {message}
            </p>
          )}
          <div>
            <button
              type="button"
              onClick={breakContext}
              disabled={disabled || pending}
              className="rounded-full border border-border bg-surface px-3.5 py-1.5 font-medium text-foreground transition-colors hover:bg-rail-active disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "区切っています…" : "ここで区切る"}
            </button>
            {disabled && <span className="ml-2">返答の生成が終わってから押せます。</span>}
          </div>
        </div>
      )}
    </div>
  );
}
