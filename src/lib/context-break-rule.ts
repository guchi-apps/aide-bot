import { jstDayKey } from "@/lib/day-key";

/**
 * 会話の区切り（#322）の判定。**Prismaに触れない純粋な関数だけ**を置く。
 *
 * 画面の説明文（`ContextBreakControl`）も同じ定数を読むので、クライアントからもimportできる。
 * DBを引く側は `src/lib/context-break.ts`。
 */

/** 自動で区切るまでの無操作時間。日をまたいだだけでは区切らない（下の `shouldAutoBreak()`）。 */
export const IDLE_BREAK_HOURS = 6;

export const IDLE_BREAK_MS = IDLE_BREAK_HOURS * 60 * 60 * 1000;

/** 区切りの種類。`ContextBreak.kind` にそのまま入る。 */
export type ContextBreakKind = "MANUAL" | "AUTO";

/**
 * 自動で区切るか。次の3つがすべて成り立つときだけ真。
 *
 * 1. 利用者本人の最後の発言が、日本時間で今日ではない
 * 2. その発言から `IDLE_BREAK_HOURS` 時間以上あいている
 * 3. 直近の区切りより後に、利用者が話している
 *
 * **日付をまたぎながら続けて話している最中は区切らない**（1だけでは真になるが2で落ちる）。
 * 3は、区切った後で利用者が話さないまま朝の見通しなどが積まれるたびに、何度も区切らないため。
 * **`lastUserMessageAt` は利用者本人の発言でしか進まない**ので、自動発言だけでは無操作時間が延びない。
 */
export function shouldAutoBreak(params: {
  lastUserMessageAt: Date | null;
  contextStartedAt: Date | null;
  now: Date;
}): boolean {
  const { lastUserMessageAt, contextStartedAt, now } = params;

  // 一度も話していない・列を足す前の会話は、区切る根拠が無い。
  if (lastUserMessageAt === null) return false;
  if (contextStartedAt !== null && contextStartedAt.getTime() >= lastUserMessageAt.getTime()) return false;
  if (jstDayKey(lastUserMessageAt) === jstDayKey(now)) return false;

  return now.getTime() - lastUserMessageAt.getTime() >= IDLE_BREAK_MS;
}
