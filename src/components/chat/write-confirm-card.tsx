"use client";

import {
  ALLOW_MESSAGE,
  DENY_MESSAGE,
  type WriteConfirm,
  type WriteConfirmStatus,
} from "@/lib/write-confirm";

const CHIP: Record<WriteConfirmStatus, string> = {
  open: "確認待ち",
  allowed: "許可しました",
  denied: "拒否しました",
  closed: "期限切れ",
};

/**
 * 秘書が書き込みの前に出す確認カード（#380）。設定の変更案（`SettingsProposalCard`）と同じ見た目。
 *
 * **ボタンは書き込みを実行しない。** 押すと許可・拒否の発言が送られるだけで、実行するのは秘書。
 * 押せるかどうかは呼び出し側が `writeConfirmStatus()` で決めて渡す（答え済み・区切りの後・
 * 今日以外の日のカードは押せない）。
 */
export function WriteConfirmCard({
  confirm,
  status,
  onAnswer,
}: {
  confirm: WriteConfirm;
  status: WriteConfirmStatus;
  onAnswer?: (text: string) => void;
}) {
  const canAnswer = status === "open" && onAnswer !== undefined;

  return (
    <div className="mt-3 flex w-full max-w-md flex-col gap-3 rounded-xl border border-accent/60 bg-surface p-3.5 text-sm">
      <div className="flex items-center justify-between gap-2 font-bold">
        {confirm.title}
        <span className="rounded-full border border-accent/60 px-2 text-[0.6875rem] font-medium text-accent">
          {CHIP[status]}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
        {confirm.rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 break-words font-bold">{row.value}</dd>
          </div>
        ))}
      </dl>
      {canAnswer && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onAnswer(ALLOW_MESSAGE)}
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-white"
          >
            許可する
          </button>
          <button
            type="button"
            onClick={() => onAnswer(DENY_MESSAGE)}
            className="rounded-lg border border-border px-3.5 py-2 text-xs"
          >
            拒否する
          </button>
        </div>
      )}
      {status === "open" && <p className="text-[0.6875rem] text-muted">許可するまで、何も変わりません。</p>}
    </div>
  );
}
