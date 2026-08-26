"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import {
  WRITE_TOOL_POLICIES,
  WRITE_TOOL_POLICY_COOKIE,
  WRITE_TOOL_POLICY_MAX_AGE,
  type WriteToolPolicy,
} from "@/lib/mcp/write-tools";
import { cn } from "@/lib/utils";

/**
 * 書き込みの道具を秘書へ渡すかどうかを選ぶ（#78）。
 *
 * 繋いだサービスの道具には、家計簿への支出登録のように**あとから取り消せない**ものがある。
 * #46 では絞り込みをしていなかったため、全ての相談・両方のモードへそのまま渡っていた。
 *
 * **止められるのは名前を把握している道具だけ**なので、接続ごとに「何を止めるのか」を
 * そのまま並べる。把握していない接続先は、設定によらず書き込みの道具が渡ることを
 * 隠さずに書く——ここを「安全になった」と読ませると、絞り込めていない接続先で
 * 同じ事故が起きる。
 */

export type WriteToolTarget = {
  label: string;
  /** その接続先で止められる道具。空なら「把握していない」。 */
  tools: string[];
  /** いま相談へ渡っているか（繋がっていて、かつ使う設定か）。 */
  inUse: boolean;
};

type Props = {
  /** サーバー側でCookieから読んだ、いまの選択。 */
  initial: WriteToolPolicy;
  /** 繋いでいる接続。休止中・未接続のものも状態を添えて並べる。 */
  targets: WriteToolTarget[];
};

/** 一覧に出す名前。いま渡っていないものはその旨を添える。 */
function targetName(target: WriteToolTarget): string {
  return target.inUse ? target.label : `${target.label}（いまは渡っていません）`;
}

export function WriteToolPicker({ initial, targets }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState(initial);

  const choose = useCallback(
    (policy: WriteToolPolicy) => {
      setSelected(policy);
      // 次の相談から効かせる。`/api/chat` がこれを読む。
      document.cookie = `${WRITE_TOOL_POLICY_COOKIE}=${policy}; path=/; max-age=${WRITE_TOOL_POLICY_MAX_AGE}; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const unknown = targets.filter((target) => target.tools.length === 0);
  const known = targets.filter((target) => target.tools.length > 0);

  return (
    <section className="flex flex-col gap-5">
      <header>
        <h3 className="text-sm font-medium">書き込みの道具</h3>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">
          繋いだサービスの道具には、家計簿への支出登録のように
          <b className="font-medium text-foreground">あとから取り消せない</b>
          ものがあります。既定では秘書に渡していません。選んだ内容はこの端末にだけ保存されます。
        </p>
      </header>

      <div className="flex flex-col gap-1.5">
        {WRITE_TOOL_POLICIES.map((policy) => (
          <label
            key={policy.id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-rail-active",
              "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
              selected === policy.id && "border-accent bg-accent-surface shadow-[0_0_0_1px_var(--accent)]",
            )}
          >
            <input
              type="radio"
              name="mcp-write-tools"
              value={policy.id}
              checked={selected === policy.id}
              onChange={() => choose(policy.id)}
              className="sr-only"
            />

            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-[15px] shrink-0 place-items-center rounded-full border-[1.5px] bg-surface",
                selected === policy.id ? "border-accent" : "border-muted",
              )}
            >
              {selected === policy.id && <span className="size-[7px] rounded-full bg-accent" />}
            </span>

            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[0.8125rem] font-semibold">{policy.label}</span>
              <span className="text-[0.6875rem] leading-relaxed text-muted">
                {policy.description}
              </span>
            </span>
          </label>
        ))}
      </div>

      {targets.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">まだ何も繋いでいません。</p>
      ) : (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
          {known.length > 0 && (
            <p>
              <b className="font-medium text-foreground">渡さないときに止まるもの</b>：
              {known.map((target) => `${targetName(target)}: ${target.tools.join("・")}`).join("、")}
            </p>
          )}

          {/* 絞り込めるのは名前を把握している接続先だけ（`MCP_PRESETS` の `writeTools`）。
              ここを黙っていると、絞り込めていない接続先まで止まっていると誤解される。 */}
          {unknown.length > 0 && (
            <p className={cn(known.length > 0 && "mt-2")}>
              <b className="font-medium text-danger">
                {unknown.map(targetName).join("・")}
              </b>
              は、どの道具が書き込みなのかを把握していないため絞り込めません。繋がっているあいだは、
              この設定によらずその接続の道具がすべて渡ります。
            </p>
          )}
        </div>
      )}

      <p className="text-xs leading-relaxed text-muted">
        渡しているときも、秘書には「登録の前に内容を復唱して確認を取る」よう指示してあります。
        呼び出しの記録は相談の履歴には残らないため、登録した内容は接続先の画面で確かめてください。
      </p>
    </section>
  );
}
