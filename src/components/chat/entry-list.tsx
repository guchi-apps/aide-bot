"use client";

import { AppIcon } from "@/components/brand/app-icon";
import { dayHeading } from "@/lib/day-key";

import { Markdown } from "./markdown";
import { ToolCallNote } from "./tool-call-note";
import type { ChatEntry } from "./types";

/**
 * 記録の並び（#157）。「書く」画面と、過去の日を読む画面（`/d/<date>`）が共有する。
 *
 * 相談を1本の連続セッションにしたので、**並びの中に日付の区切りが要る。** 区切りは
 * `ChatEntry.day`（日本時間の `2026-09-03`）が変わったところに出す。
 *
 * **見出しの組み立てはサーバーでもクライアントでも同じ結果になる**（`dayHeading()` は
 * タイムゾーンを明示している）ので、ハイドレーションはずれない。ただし「今日」の判定に
 * 使う `todayKey` はサーバーで確定させて渡す——`new Date()` をクライアントで呼ぶと、
 * 日付が変わる瞬間に描き直した画面だけ見出しがずれる。
 */
export function EntryList({
  entries,
  todayKey,
}: {
  entries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。 */
  todayKey: string;
}) {
  return (
    <>
      {entries.map((entry, index) => {
        // 送ったばかりの発言には日付が入っていない（画面の中だけで足したもの）。
        // それは必ず今日のものなので、今日として扱う。
        const day = entry.day ?? todayKey;
        const previousDay = index === 0 ? null : (entries[index - 1].day ?? todayKey);

        return (
          <div key={entry.id} className="flex flex-col gap-6">
            {day !== previousDay && <DaySeparator heading={dayHeading(day, todayKey)} />}
            <Entry entry={entry} />
          </div>
        );
      })}
    </>
  );
}

/**
 * 日付の区切り。
 *
 * 記録そのものではないので、発言より小さく・弱い色で置く。線で挟むのは、上下の発言の
 * どちらに属する見出しなのかを見た目で切るため。
 */
export function DaySeparator({ heading }: { heading: string }) {
  return (
    <div className="flex items-center gap-3 text-[0.6875rem] font-bold tracking-[0.1em] text-muted">
      <span className="h-px w-3 bg-border" aria-hidden="true" />
      {heading}
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

function Entry({ entry }: { entry: ChatEntry }) {
  if (entry.kind === "tool") return <ToolCallNote call={entry} />;

  if (entry.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border border-accent/25 bg-accent-surface px-4 py-2.5 text-sm md:max-w-[30rem]">
          {entry.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <SecretaryAvatar />
      <div className="min-w-0 flex-1">
        <SecretaryLabel />
        <Markdown>{entry.content}</Markdown>
        {entry.interrupted && <InterruptedNote />}
      </div>
    </div>
  );
}

export function SecretaryAvatar() {
  return <AppIcon className="mt-0.5 size-[26px] shrink-0" />;
}

export function SecretaryLabel() {
  return <div className="mb-1 text-[0.6875rem] font-bold tracking-[0.08em] text-muted">秘書</div>;
}

/**
 * 割り込まれた返答であることの印（#48）。
 *
 * 途中で切れた文はそれだけ見ると尻切れの返答に見え、あとから読み返したときに秘書が
 * 言い損ねたのか自分が遮ったのかが分からない。
 */
function InterruptedNote() {
  return (
    <p className="mt-1.5 text-[0.6875rem] text-muted">
      — ここで割り込んだため、返答は途中で止まっています
    </p>
  );
}

/**
 * 畳んだ古い発言があることの印（#157のcompact）。
 *
 * **出さないと「昔の話を覚えていない」が不具合に見える。** 記録そのものは日付の一覧から
 * 辿れて消えていないので、消えたのではなく畳んだのだと分かる文言にしてある。
 */
export function CompactedNote({ count }: { count: number }) {
  return (
    <p className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-rail px-3.5 py-2.5 text-xs leading-relaxed text-muted">
      <span aria-hidden="true" className="mt-[0.15rem] font-bold">
        ≡
      </span>
      ここまでの発言{count.toLocaleString()}件は要約にまとめてあります。秘書が話を続けるときの
      下敷きとして使われます。やり取りそのものは左の日付から読めます。
    </p>
  );
}
