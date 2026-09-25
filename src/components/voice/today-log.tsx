"use client";

import { stripProposal } from "@/lib/settings-proposal";
import { Volume2, VolumeX } from "lucide-react";
import { memo } from "react";

import { ToolCallNote } from "@/components/chat/tool-call-note";
import type { ChatEntry } from "@/components/chat/types";
import { dayHeading } from "@/lib/day-key";
import { cn } from "@/lib/utils";

type Props = {
  entries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。日付の区切りに使う（#157）。 */
  todayKey: string;
  /** 読み上げが入か。記録の下に一言添える。 */
  speak: boolean;
};

/**
 * 「話す」画面の右に添える、いまの相談のやり取り。声だけだと直前しか追えない。
 *
 * **`memo` で包んで、記録が変わったときだけ描き直す**（#228）。この欄は聞き取りの途中経過
 * （interim）や返答の差分では変わらないのに、以前は `VoicePanel` の一部だったため、それらの
 * たびに全件が描き直されていた。props は `entries`（足すたびに作り直す配列）・`todayKey`・
 * `speak` だけで、どれも描き直しのたびには変わらない。**関数やオブジェクトを新しく渡さない**
 * ——渡すと `memo` が毎回外れる。
 *
 * 「書く」の `EntryList`（`@/components/chat/entry-list`）とは幅・文字の大きさ・隠す発言
 * （#280）が違うので別に持っている。
 */
export const TodayLog = memo(function TodayLog({ entries, todayKey, speak }: Props) {
  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-surface lg:flex">
      <h2 className="border-b border-border px-4 py-3 text-xs font-medium text-muted">今日の記録</h2>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
        {entries.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted">話しかけると、ここにやり取りが残ります。</p>
        ) : (
          /*
            日付の区切りを挟む（#157）。今日まだ話していない朝はきのうの終わりから
            続けて出るので、区切りが無いと「今日もう話した」ように見える。
          */
          entries.map((entry, index) => {
            const day = entry.day ?? todayKey;
            const previousDay = index === 0 ? null : (entries[index - 1].day ?? todayKey);

            return (
              <div key={entry.id} className="flex flex-col gap-3.5">
                {day !== previousDay && (
                  <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted">
                    {dayHeading(day, todayKey)}
                  </span>
                )}
                {entry.kind === "tool" ? (
                  <ToolCallNote call={entry} compact />
                ) : entry.kind === "break" ? (
                  <p className="border-t border-dashed border-border pt-2 text-[0.625rem] font-bold tracking-[0.08em] text-muted">
                    ここから新しい会話
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted">
                      {entry.role === "USER" ? "わたし" : "秘書"}
                    </span>
                    <p
                      className={cn(
                        "whitespace-pre-wrap break-words text-xs leading-relaxed",
                        entry.role === "USER" &&
                          "rounded-[10px_10px_10px_3px] bg-accent-surface px-2.5 py-1.5",
                      )}
                    >
                      {stripProposal(entry.content)}
                    </p>
                    {entry.interrupted && (
                      <p className="text-[0.625rem] text-muted">— ここで割り込みました</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
      <p className="flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-[0.6875rem] text-muted">
        {speak ? (
          <Volume2 className="size-3.5" aria-hidden="true" />
        ) : (
          <VolumeX className="size-3.5" aria-hidden="true" />
        )}
        {speak ? "読み上げは入" : "読み上げは切"}
      </p>
    </aside>
  );
});
