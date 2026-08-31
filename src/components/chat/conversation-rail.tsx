"use client";

import { BarChart3, Bell, Plus, Settings, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { AppIcon } from "@/components/brand/app-icon";
import { cn } from "@/lib/utils";

import type { ConversationSummary } from "./types";

type Props = {
  conversations: ConversationSummary[];
  activeId: string | null;
  /** 使用量の画面を開いているか。相談は選ばれていない状態になる。 */
  isUsageActive: boolean;
  /** 設定の画面を開いているか。使用量と同じく、相談は選ばれていない状態になる（#46）。 */
  isSettingsActive: boolean;
  /** お知らせの画面を開いているか（#114）。 */
  isNoticesActive: boolean;
  /** まだ秘書が出していないお知らせの件数（#114）。0のときは数字を出さない。 */
  pendingNoticeCount: number;
  /** 今月の概算費用（`$1.23` の形）。集計はサーバー側で済ませて文字列で受け取る。 */
  monthlyCostLabel: string;
  userLabel: string;
  userEmail: string | null;
  appVersion: string;
  onNavigate?: () => void;
};

/**
 * 相談の一覧。PCでは常に見えている左の帯、スマホではドロワーの中身として同じものを使う。
 */
export function ConversationRail({
  conversations,
  activeId,
  isUsageActive,
  isSettingsActive,
  isNoticesActive,
  pendingNoticeCount,
  monthlyCostLabel,
  userLabel,
  userEmail,
  appVersion,
  onNavigate,
}: Props) {
  const router = useRouter();
  const headingId = useId();

  // 削除の確認（#102）。押した相談を持っておき、確認を通った時点で初めて消す。
  const [pending, setPending] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const closeConfirm = () => {
    // 消している最中に閉じると、結果を出す先が無くなる。
    if (deleting) return;
    setPending(null);
    setError(null);
  };

  // 確認が出ている間だけEscapeで閉じる。ドロワー（ChatShell）と同じ扱い。
  useEffect(() => {
    if (!pending) return;

    const onKeyDown = (event: KeyboardEvent) => {
      // 消している最中は閉じない。結果を出す先が無くなる。
      if (event.key !== "Escape" || deleting) return;
      setPending(null);
      setError(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pending, deleting]);

  // 開いた直後は「やめる」に合わせる。取り消せない操作なので、Enterの連打で消えないようにする。
  useEffect(() => {
    if (pending) cancelRef.current?.focus();
  }, [pending]);

  const deletePending = async () => {
    if (!pending || deleting) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(pending.id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "消せませんでした。少し待ってからもう一度お試しください。");
        setDeleting(false);
        return;
      }

      const wasActive = pending.id === activeId;
      setPending(null);
      setDeleting(false);

      // 開いていた相談を消したら、消えたページに取り残されないよう新しい相談へ戻す。
      // それ以外は見ている画面のままで、一覧だけを取り直す。
      if (wasActive) {
        onNavigate?.();
        router.replace("/");
      }
      router.refresh();
    } catch {
      setError("通信に失敗しました。電波の状態を確かめて、もう一度お試しください。");
      setDeleting(false);
    }
  };

  let lastGroup: string | null = null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-rail">
      <div className="flex flex-col gap-3.5 px-4 pb-3.5 pt-4">
        <div className="flex items-center gap-2.5 text-[0.9375rem] font-semibold">
          <AppIcon className="size-6" />
          秘書アプリ
        </div>

        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center justify-center gap-1.5 rounded-[10px] bg-accent px-3 py-2.5 text-[0.8125rem] font-medium text-accent-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          新しい相談
        </Link>
      </div>

      <nav aria-label="過去の相談" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted">
            まだ相談がありません。下の入力欄から話しかけてください。
          </p>
        ) : (
          conversations.map((conversation) => {
            // 同じ見出しが続く間は出さない。並びは更新が新しい順なので、グループも順に切り替わる。
            const heading = conversation.group === lastGroup ? null : conversation.group;
            lastGroup = conversation.group;

            return (
              <div key={conversation.id}>
                {heading && (
                  <div className="px-1.5 pb-1 pt-3.5 text-[0.6875rem] font-bold tracking-[0.1em] text-muted">
                    {heading}
                  </div>
                )}
                {/*
                  リンクと消すボタンは入れ子にできない（リンクの中にボタンは置けない）ので、
                  同じ行の中に並べる。地の色と選択中の印は、行そのものへ移してある。
                */}
                <div
                  className={cn(
                    "group flex items-center rounded-[9px] pr-0.5 transition-colors hover:bg-rail-active",
                    conversation.id === activeId &&
                      "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
                  )}
                >
                  <Link
                    href={`/c/${conversation.id}`}
                    onClick={onNavigate}
                    aria-current={conversation.id === activeId ? "page" : undefined}
                    className={cn(
                      "min-w-0 flex-1 truncate rounded-[9px] py-2 pl-2.5 pr-1 text-[0.8125rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                      conversation.id === activeId && "font-medium",
                    )}
                  >
                    {conversation.title}
                  </Link>

                  {/*
                    指で触る端末には「乗せる」操作が無いので常に出す。PCでは行に乗せたとき・
                    キーボードで送ったときだけ出し、並んだ相談の見た目を普段は変えない。

                    **隠すかどうかは幅ではなくホバーの有無で決める。** Tailwindの
                    `group-hover:` は `@media (hover: hover)` の中にしか出ないので、
                    `md:` で隠すとiPad（幅1180px・ホバー無し）でバツが永久に出なくなる。
                  */}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setPending(conversation);
                    }}
                    aria-label={`「${conversation.title}」を消す`}
                    className="grid size-[26px] shrink-0 place-items-center rounded-[7px] text-muted transition-opacity hover:bg-surface hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:hover)]:opacity-0"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </nav>

      <div className="border-t border-border">
        {/* 積まれたお知らせ（#114）。相談ではないので、使用量・設定と同じく下部に置く。
            未読は「秘書がまだ話していない件数」で、chatter.ts が数えているものと同じ。 */}
        <Link
          href="/notices"
          onClick={onNavigate}
          aria-current={isNoticesActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isNoticesActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <Bell className="size-3.5 text-muted" aria-hidden="true" />
            お知らせ
          </span>
          {pendingNoticeCount > 0 && (
            <span className="tabular-nums font-bold text-accent">未読 {pendingNoticeCount}</span>
          )}
        </Link>

        {/* 返答のモデル（#71）と外部サービスとの接続（#46）。相談ではないので、一覧ではなく下部に置く。 */}
        <Link
          href="/settings"
          onClick={onNavigate}
          aria-current={isSettingsActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center gap-1.5 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isSettingsActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <Settings className="size-3.5 text-muted" aria-hidden="true" />
          設定
        </Link>

        {/* APIの消費量（#51）。金額だけを一覧に出し、内訳は専用の画面で見る。 */}
        <Link
          href="/usage"
          onClick={onNavigate}
          aria-current={isUsageActive ? "page" : undefined}
          className={cn(
            "mx-2.5 mt-2 flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-[0.8125rem] transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
            isUsageActive && "bg-rail-active shadow-[inset_2px_0_0_var(--accent)]",
          )}
        >
          <span className="flex items-center gap-1.5">
            <BarChart3 className="size-3.5 text-muted" aria-hidden="true" />
            使用量
          </span>
          <span className="tabular-nums font-bold text-accent">今月 {monthlyCostLabel}</span>
        </Link>

        <div className="flex items-center justify-between gap-2.5 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <b className="block text-[0.8125rem] font-medium">{userLabel}</b>
            {userEmail && <span className="block truncate text-[0.6875rem] text-muted">{userEmail}</span>}
          </div>

          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="whitespace-nowrap rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:bg-rail-active"
            >
              ログアウト
            </button>
          </form>
        </div>

        {/* どの版を見ているかが画面だけで分かるようにする。値は package.json の version。 */}
        <p className="px-4 pb-3 text-[0.6875rem] text-muted">v{appVersion}</p>
      </div>

      {/*
        削除の確認（#102）。押し間違いが元に戻せないので、その場では消さずに一度受け止める。
        スマホのドロワー（ChatShellのz-50）より前に出す必要があるため、z-indexはそれより上。
      */}
      {pending && (
        <>
          <button
            type="button"
            aria-label="確認を閉じる"
            onClick={closeConfirm}
            // ライト・ダークのどちらでも背後を沈ませたいので、テーマ変数ではなく黒を敷く。
            className="fixed inset-0 z-[60] bg-black/50"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            className="fixed left-1/2 top-1/2 z-[70] w-[min(340px,calc(100vw_-_2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-surface p-5 shadow-2xl"
          >
            <h2 id={headingId} className="text-[0.9375rem] font-bold">
              この相談を消しますか？
            </h2>
            <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-muted">
              <span className="font-medium text-foreground">「{pending.title}」</span>
              のやり取りがすべて消えます。元には戻せません。
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-lg border border-danger/40 bg-danger-surface px-3 py-2 text-xs leading-relaxed text-danger"
              >
                {error}
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={closeConfirm}
                disabled={deleting}
                className="rounded-[9px] border border-border bg-surface px-4 py-2 text-[0.8125rem] text-muted transition-colors hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={deletePending}
                disabled={deleting}
                className="rounded-[9px] bg-danger px-4 py-2 text-[0.8125rem] font-bold text-surface transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger disabled:opacity-50"
              >
                {deleting ? "消しています…" : "消す"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
