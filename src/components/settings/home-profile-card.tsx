"use client";

import { CircleAlert, House, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Notionから取り込んだ「自宅と暮らしの前提」（#167）。
 *
 * **見せることそのものが目的の1つ。** 何が連携できていて何ができていないのかが画面から
 * 分からない、というのがこのIssueの出発点なので、取り込んだ本文をそのまま出す。
 * 秘書が相談のときに手元へ置いているのはここに出ている文そのもの。
 *
 * 取り込みは普段cronが1日1回走らせる（`src/lib/home-profile.ts`）。このボタンは、繋いだ
 * 直後やNotionを直した直後に翌朝まで待たずに済ませるための入口。
 */

type Props = {
  /** サーバー側でDBから読んだ、いまの覚え書き。 */
  initialProfile: string | null;
  /** 最後に取り込んだ時刻（日本時間で整形済み）。一度も取り込んでいなければnull。 */
  fetchedAtLabel: string | null;
  /** Notionへ繋いでいるか。繋いでいなければ取り込めないので先に案内する。 */
  notionConnected: boolean;
};

export function HomeProfileCard({ initialProfile, fetchedAtLabel, notionConnected }: Props) {
  const [profile, setProfile] = useState(initialProfile);
  const [fetchedAt, setFetchedAt] = useState(fetchedAtLabel);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setRunning(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings/home-profile", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        status?: string;
        profile?: string | null;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? "取り込めませんでした。");
      }

      setProfile(body.profile ?? null);
      // サーバーの時刻を待たずに「いま取り込んだ」ことだけ出す（次に開けば実際の時刻が出る）。
      setFetchedAt("たったいま");
      setMessage(
        body.status === "saved"
          ? { tone: "info", text: "Notionから取り込みました" }
          : { tone: "error", text: "Notionに自宅の情報が見当たりませんでした" },
      );
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "取り込めませんでした。",
      });
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">自宅の情報</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          住まいや暮らしの前提をNotionから取り込み、秘書が相談のたびに手元へ置いておく覚え書きです。
          これがあると、天気や地域の話で場所を聞き返されなくなります。1日に1回、自動で取り込み直します。
        </p>
      </header>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-4">
        <div className="flex items-center gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-surface text-accent">
            <House className="size-[22px]" aria-hidden="true" />
          </span>

          <div className="min-w-0 flex-1">
            <b className="block text-sm font-medium">Notionの自宅情報</b>
            <p className="mt-0.5 text-[0.6875rem] text-muted">
              {fetchedAt ? `最終取得: ${fetchedAt}` : "まだ取り込んでいません"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={running}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", running && "animate-spin")} aria-hidden="true" />
            {running ? "取り込み中" : profile ? "取り込み直す" : "取り込む"}
          </button>
        </div>

        {profile ? (
          <p className="whitespace-pre-wrap rounded-lg bg-rail px-3.5 py-3 text-xs leading-relaxed">
            {profile}
          </p>
        ) : (
          <p className="rounded-lg bg-rail px-3.5 py-3 text-xs leading-relaxed text-muted">
            まだ何も取り込めていません。秘書は自宅の場所を知らないので、地域の話では場所を尋ねます。
          </p>
        )}

        {message && (
          <p
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium",
              message.tone === "error" ? "text-danger" : "text-accent",
            )}
          >
            {message.tone === "error" && (
              <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            {message.text}
          </p>
        )}

        {!notionConnected && (
          <p className="flex items-start gap-2 rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
            Notionへ繋いでいません。下の「接続」からNotionへ繋ぐと取り込めるようになります。
          </p>
        )}

        <p className="flex items-start gap-2 rounded-lg bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          取り込みにはNotionの検索が入るため、押してから30秒ほどかかります。
          ここに出ている文は、そのまま相談のたびに秘書へ渡ります。
        </p>
      </div>
    </section>
  );
}
