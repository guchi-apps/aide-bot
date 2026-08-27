"use client";

import { PencilLine } from "lucide-react";

import type { ChatToolCall } from "@/components/chat/types";
import { toolCallFields } from "@/lib/tool-call";
import { cn } from "@/lib/utils";

/**
 * 書き込みの道具を使ったことを、相談の中に残す行（#81）。
 *
 * #78 までは、生成中に「AIDEを調べています…」と一瞬出るだけで、再読み込みすると消えていた。
 * **あとから「何を登録したのか」を辿るには接続先の画面を見に行くしかなかった**ので、
 * ここでは渡した引数をそのまま並べる。金額・日付・店名のような、聞き間違いが記録になる値を
 * 確かめられることが目的なので、丸めたり要約したりしない。
 *
 * 秘書の返答とは見た目を分ける。**これは秘書が言ったことではなく、実際に外へ出た操作**で、
 * 同じ吹き出しに混ぜると「そう答えた」だけのものと見分けが付かない。
 */

type Props = {
  call: ChatToolCall;
  /** 「話す」の右側の記録欄など、幅の無いところ向け。 */
  compact?: boolean;
};

/** 見出しの文言。失敗も同じ形で残す——「試したが入らなかった」ことも辿れる必要がある。 */
function headline(call: ChatToolCall): string {
  if (call.failed) return `${call.server}への書き込みは失敗しました`;
  // 結果を受け取る前に打ち切られた往復。**入っていない、とは言い切れない。**
  if (call.output === null) return `${call.server}へ書き込みました（結果は未確認）`;
  return `${call.server}へ書き込みました`;
}

export function ToolCallNote({ call, compact = false }: Props) {
  const fields = toolCallFields(call.input);

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface",
        compact ? "px-2.5 py-2" : "px-3.5 py-2.5",
        call.failed ? "border-danger/30" : "border-accent/30",
      )}
    >
      <p
        className={cn(
          "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-medium",
          compact ? "text-[0.6875rem]" : "text-xs",
          call.failed && "text-danger",
        )}
      >
        <PencilLine
          className={cn("shrink-0", compact ? "size-3" : "size-3.5", !call.failed && "text-accent")}
          aria-hidden="true"
        />
        {headline(call)}
        <span className="font-normal text-muted">（{call.tool}）</span>
      </p>

      {fields.length > 0 && (
        <dl
          className={cn(
            "mt-1.5 grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-0.5",
            compact ? "text-[0.625rem]" : "text-xs",
          )}
        >
          {fields.map((field) => (
            <div key={field.key} className="col-span-2 grid grid-cols-subgrid">
              <dt className="text-muted">{field.key}</dt>
              <dd className="min-w-0 break-words">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {call.output !== null && call.output.trim() !== "" && (
        <p
          className={cn(
            "mt-1.5 whitespace-pre-wrap break-words leading-relaxed",
            compact ? "text-[0.625rem]" : "text-[0.6875rem]",
            call.failed ? "text-danger" : "text-muted",
          )}
        >
          {call.output}
        </p>
      )}
    </div>
  );
}
