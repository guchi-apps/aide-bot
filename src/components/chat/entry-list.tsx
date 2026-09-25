"use client";

import { memo } from "react";

import { AppIcon } from "@/components/brand/app-icon";
import { isAutoRequest } from "@/lib/auto-request";
import { dayHeading } from "@/lib/day-key";

import { Markdown } from "./markdown";
import { SettingsProposalCard } from "./settings-proposal-card";
import { extractProposal } from "@/lib/settings-proposal";
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
 *
 * **秘書の側が自動で積んだ依頼文（朝の見通し・急ぎのお知らせ。#280）は並べない。** 利用者が
 * 書いた発言ではないので、吹き出しに出ると自分が言ったことのように見える。DBには残して
 * あり、モデルへ渡す履歴にも入る。**日付の区切りは隠した後の並びで判定する**——隠す前の並びで
 * 見ると、隠した発言が日の最初だった日は、区切りが最初に見える発言へ付かなくなる。
 */
function EntryListView({
  entries: allEntries,
  todayKey,
}: {
  entries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。 */
  todayKey: string;
}) {
  const entries = allEntries.filter((entry) => entry.kind !== "message" || !isAutoRequest(entry.role, entry.content));

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
 * `memo` で包んで、記録（`entries`）か今日の日付が変わったときだけ描き直す（#228）。
 *
 * 「書く」画面は声で話している間、聞き取りの途中経過（interim）のたびに描き直される。発言ごとに
 * Markdownを組み直すこの並びまで巻き込むと、記録が長いほど詰まる。**`entries` は足したときに
 * だけ作り直される配列なので、そのまま比べてよい。**
 */
export const EntryList = memo(EntryListView);

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
  if (entry.kind === "break") return <ContextBreakLine breakKind={entry.breakKind} time={entry.time} />;

  if (entry.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border border-accent/25 bg-accent-surface px-4 py-2.5 text-sm md:max-w-[30rem]">
          {entry.content}
        </div>
      </div>
    );
  }

  const proposal = extractProposal(entry.content);

  return (
    <div className="flex gap-3">
      <SecretaryAvatar />
      <div className="min-w-0 flex-1">
        <SecretaryLabel time={entry.time} proactive={entry.proactive} />
        <Markdown>{proposal.text}</Markdown>
        {proposal.changes.length > 0 && <SettingsProposalCard changes={proposal.changes} />}
        {entry.interrupted && <InterruptedNote />}
      </div>
    </div>
  );
}

/**
 * 会話を区切った線（#322）。**上の記録は消えていない**ので、線は「ここから先は前の話を
 * 引き継がない」だけを示し、履歴の削除に見えない弱い色で置く。
 */
export function ContextBreakLine({ breakKind, time }: { breakKind: "MANUAL" | "AUTO"; time?: string }) {
  return (
    <div className="flex items-center gap-3 text-[0.6875rem] font-bold tracking-[0.06em] text-accent">
      <span className="h-px flex-1 border-t border-dashed border-accent/50" aria-hidden="true" />
      <span>
        ここから新しい会話
        <span className="ml-1.5 font-medium text-muted">
          （{breakKind === "AUTO" ? "しばらく話さなかったため自動で区切りました" : "区切りました"}
          {time ? ` ${time}` : ""}）
        </span>
      </span>
      <span className="h-px flex-1 border-t border-dashed border-accent/50" aria-hidden="true" />
    </div>
  );
}

export function SecretaryAvatar() {
  return <AppIcon className="mt-0.5 size-[26px] shrink-0" />;
}

/**
 * 「秘書」の名前の行。`time`（`07:00`）があれば右に添える（#280）。
 *
 * 返答がいつのものかは、日付の区切りだけでは朝の見通しと後の返答が見分けられない。生成中の
 * 枠（`ChatPanel` の考えています…）には渡さない——保存される前で、まだ時刻が無い。
 *
 * **秘書の側から話しかけた発言（#278）は名前を差し替える。** 頼んでいないのに現れる発言なので、
 * 返答と同じ見た目だと「何に対する返事なのか」を探すことになる。流れの中で目に留まるよう、
 * 地の文の名札ではなくaccentの小さな枠で出す。読み上げソフトには「秘書から話しかけました」と
 * 伝える——見た目で読み取れる差（色と枠）が音では消えるため。
 */
export function SecretaryLabel({ time, proactive = false }: { time?: string; proactive?: boolean }) {
  return (
    <div className="mb-1 flex items-baseline gap-2 text-[0.6875rem] text-muted">
      {proactive ? (
        <span className="inline-flex items-center rounded-full bg-accent-surface px-2 py-0.5 font-bold tracking-[0.08em] text-accent">
          秘書から
          <span className="sr-only">話しかけました</span>
        </span>
      ) : (
        <span className="font-bold tracking-[0.08em]">秘書</span>
      )}
      {time && <time className="font-medium tracking-[0.02em] tabular-nums">{time}</time>}
    </div>
  );
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
