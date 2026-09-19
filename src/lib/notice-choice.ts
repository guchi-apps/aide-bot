import { NOTICE_SKIP_TOKEN, NOTICE_URGENT_MARK } from "@/lib/anthropic";

/**
 * お知らせの選定で、モデルの返答を読む部分（#93・#265）。**Prismaもcodexも持ち込まない純粋な関数だけ。**
 *
 * `notices.ts` はDBとCodexを引き込むため、単体テスト（`test/`）から読めない。返答の形の読み違いは
 * 画面に出ないまま関係の無いお知らせを消費するので、テストで固定できるよう切り出してある。
 */

/** モデルの返答。1行目が「番号（と急ぎの印）」、2行目が吹き出しに出す文。 */
export type Choice = { index: number; urgent: boolean; text: string };

/**
 * モデルの返答を読む。**知らない形で返ってきたら黙る**（nullを返す）。
 *
 * 無理に読み取ろうとすると、前置きの一文がそのまま吹き出しに出たり、番号として読めない
 * ものを0番と見なして関係の無いお知らせを消費したりする。
 */
export function parseChoice(answer: string, candidates: number): Choice | null {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) return null;
  if (lines[0] === NOTICE_SKIP_TOKEN) return null;

  const head = /^(\d+)(?:\s+(\S+))?$/.exec(lines[0]);
  if (!head) return null;

  const index = Number(head[1]) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= candidates) return null;

  const text = lines.slice(1).join(" ");
  if (text === "") return null;

  return { index, urgent: head[2] === NOTICE_URGENT_MARK, text };
}
