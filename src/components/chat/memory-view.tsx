"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { jstDayKey } from "@/lib/day-key";
import {
  MEMORY_CONFIDENCE_LABELS,
  MEMORY_KIND_LABELS,
  NOTION_FRESH_MS,
  type MemoryConfidenceName,
  type MemoryKindName,
  type MemoryStatusName,
} from "@/lib/memory-labels";
import { cn } from "@/lib/utils";

export type MemoryRow = {
  id: string;
  kind: MemoryKindName;
  content: string;
  status: MemoryStatusName;
  confidence: MemoryConfidenceName;
  sourceQuote: string;
  sourceAt: string;
  updatedAt: string;
  notionStatus: string | null;
  notionUrl: string | null;
  notionCheckedAt: string | null;
};

type Props = {
  memories: MemoryRow[];
  now: string;
  /** Notionへ繋いでいるか。繋いでいなければ照合・記録のボタンを出さず、理由を案内する。 */
  notionConnected: boolean;
};

const NOTION_LABELS: Record<string, string> = {
  open: "Notion: 未実施",
  done: "Notion: 達成済み",
  skipped: "Notion: 見送り",
  not_found: "Notion: 未登録",
};

/**
 * 継続記憶の一覧（#323）。候補を確かめて残す・直す・見送る、確定を忘れる。
 *
 * **候補は自動で確定しない。** 相談に使われるのは「確定」だけで、忘れた記憶は以後の回答に出ない。
 * 出典（元の発言）と日時を常に並べる。Notionの状態が確認できていないときは、そう書く。
 */
export function MemoryView({ memories, now, notionConnected }: Props) {
  const candidates = memories.filter((memory) => memory.status === "CANDIDATE");
  const confirmed = memories.filter((memory) => memory.status === "CONFIRMED");
  const forgotten = memories.filter((memory) => memory.status === "FORGOTTEN");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <Section title="確かめてほしい候補" note="会話から抜き出しただけで、まだ相談には使われません" empty="候補はありません。">
          {candidates.map((memory) => (
            <MemoryItem key={memory.id} memory={memory} now={now} notionConnected={notionConnected} />
          ))}
        </Section>

        <Section title="残した記憶" note="相談のときに秘書が根拠として使います" empty="まだ残した記憶はありません。">
          {confirmed.map((memory) => (
            <MemoryItem key={memory.id} memory={memory} now={now} notionConnected={notionConnected} />
          ))}
        </Section>

        {forgotten.length > 0 && (
          <Section title="忘れた記憶" note="以後の回答には使われません" empty="">
            {forgotten.map((memory) => (
              <MemoryItem key={memory.id} memory={memory} now={now} notionConnected={notionConnected} />
            ))}
          </Section>
        )}

        <p className="text-[0.6875rem] leading-relaxed text-muted">
          <b className="font-medium text-foreground">会話の要約とは別の記憶です。</b>
          会話を区切っても残ります。行きたい・やりたいことの正本はNotionの「いつかやりたいこと」で、ここには複製を
          作りません（Notionへの記録は、押したときだけ行います）。パスワードなどの秘密情報は記憶しません。
          達成・見送りになったことは、古い会話よりNotionの状態を優先します。
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  empty,
  children,
}: {
  title: string;
  note: string;
  empty: string;
  children: React.ReactNode[];
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.8125rem] font-bold">
          {title}（{children.length}件）
        </h2>
        <span className="text-[0.6875rem] text-muted">{note}</span>
      </div>
      {children.length === 0 ? <p className="text-xs text-muted">{empty}</p> : <div className="flex flex-col">{children}</div>}
    </section>
  );
}

function MemoryItem({ memory, now, notionConnected }: { memory: MemoryRow; now: string; notionConnected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(memory.content);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  const run = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/memory/${memory.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!response.ok) throw new Error(data.error ?? "操作できませんでした。");

      if (action === "notion_record") {
        setMessage({
          tone: "info",
          text: data.status === "created" ? "Notionへ記録しました。" : "Notionにすでにあったので、追加せずに紐づけました。",
        });
      }
      setEditing(false);
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "操作できませんでした。" });
    } finally {
      setBusy(null);
    }
  };

  const isWish = memory.kind === "WISH";
  const notionStale =
    memory.notionCheckedAt !== null &&
    new Date(now).getTime() - new Date(memory.notionCheckedAt).getTime() > NOTION_FRESH_MS;
  const notionText = !isWish
    ? null
    : memory.notionStatus === null || memory.notionCheckedAt === null
      ? "Notionでの状態は未確認"
      : `${NOTION_LABELS[memory.notionStatus] ?? memory.notionStatus}（${jstDayKey(new Date(memory.notionCheckedAt))}に確認${notionStale ? "・古い" : ""}）`;
  const closedInNotion = memory.notionStatus === "done" || memory.notionStatus === "skipped";

  return (
    <article className={cn("flex flex-col gap-2 border-t border-border py-3 first:border-t-0 first:pt-0", memory.status === "FORGOTTEN" && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6875rem] text-muted">
        <span className="rounded-full border border-border px-2 py-0.5">{MEMORY_KIND_LABELS[memory.kind]}</span>
        <span>{MEMORY_CONFIDENCE_LABELS[memory.confidence]}</span>
        <span>更新 {jstDayKey(new Date(memory.updatedAt))}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={200}
            aria-label="記憶の内容"
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm"
          />
          <div className="flex gap-2">
            <ActionButton onClick={() => run("edit", { content: draft })} busy={busy === "edit"} primary>
              保存
            </ActionButton>
            <ActionButton
              onClick={() => {
                setEditing(false);
                setDraft(memory.content);
              }}
              busy={false}
            >
              やめる
            </ActionButton>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-relaxed">{memory.content}</p>
      )}

      <p className="text-[0.6875rem] leading-relaxed text-muted">
        元の発言（{jstDayKey(new Date(memory.sourceAt))}）: 「{memory.sourceQuote}」
      </p>

      {notionText && (
        <p className={cn("text-[0.6875rem]", closedInNotion ? "font-medium text-accent" : "text-muted")}>
          {notionText}
          {closedInNotion && " — 回答の根拠には使いません"}
          {memory.notionUrl && (
            <>
              {" "}
              <a href={memory.notionUrl} target="_blank" rel="noopener noreferrer" className="underline">
                Notionで開く
              </a>
            </>
          )}
        </p>
      )}

      {memory.status !== "FORGOTTEN" && !editing && (
        <div className="flex flex-wrap gap-2">
          {memory.status === "CANDIDATE" && (
            <>
              <ActionButton onClick={() => run("confirm")} busy={busy === "confirm"} primary>
                残す
              </ActionButton>
              <ActionButton onClick={() => run("dismiss")} busy={busy === "dismiss"}>
                見送る
              </ActionButton>
            </>
          )}
          <ActionButton onClick={() => setEditing(true)} busy={false}>
            直す
          </ActionButton>
          {memory.status === "CONFIRMED" && (
            <ActionButton onClick={() => run("forget")} busy={busy === "forget"}>
              忘れる
            </ActionButton>
          )}
          {memory.status === "CONFIRMED" && isWish && notionConnected && (
            <>
              <ActionButton onClick={() => run("notion_check")} busy={busy === "notion_check"}>
                Notionで確認
              </ActionButton>
              <ActionButton onClick={() => run("notion_record")} busy={busy === "notion_record"}>
                Notionへ記録
              </ActionButton>
            </>
          )}
        </div>
      )}

      {message && (
        <p role="status" className={cn("text-[0.6875rem]", message.tone === "error" ? "text-red-600" : "text-muted")}>
          {message.text}
        </p>
      )}
    </article>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        primary ? "border-accent bg-accent text-white" : "border-border hover:bg-rail-active",
      )}
    >
      {busy ? "処理中…" : children}
    </button>
  );
}
