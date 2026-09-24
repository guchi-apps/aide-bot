import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import {
  containsSecret,
  dedupeKeyOf,
  formatMemoryBlock,
  MEMORY_CONTENT_MAX,
  type NotionCheckResult,
  type ParsedCandidate,
} from "@/lib/memory-rule";

/**
 * 継続記憶（#323）の取り出しと状態の遷移。**サーバー専用。**
 *
 * 状態は候補 → 確定 →（忘れる）、候補 →（見送り）。**回答の根拠に使うのは確定だけ**で、
 * 忘れた・見送った記憶は本文を残したまま二度と使わない（同じ内容を候補へ蘇らせないため、
 * `(userId, dedupeKey)` の一意制約で残す）。要約（`Conversation.summary`）からの移行は無い。
 */

export type MemoryAction = "confirm" | "dismiss" | "forget" | "edit";

export type MemoryActionResult = { ok: true } | { ok: false; error: string; status: number };

const MEMORY_LIST_LIMIT = 200;

/** 画面に並べる記憶。見送った候補は出さず、忘れた記憶は末尾に薄く出す。 */
export async function listMemories(userId: string) {
  return db.memory.findMany({
    where: { userId, status: { in: ["CANDIDATE", "CONFIRMED", "FORGOTTEN"] } },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: MEMORY_LIST_LIMIT,
  });
}

/**
 * 相談のプロンプトへ載せるブロック。確定のうち回答の根拠にできるものだけ（空なら空文字）。
 * 例外は呼び出し元が握り、`MEMORY_UNAVAILABLE_NOTE` を代わりに載せる。
 */
export async function memoryBlockForChat(userId: string, now: Date): Promise<string> {
  const memories = await db.memory.findMany({
    where: { userId, status: "CONFIRMED" },
    orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
    take: MEMORY_LIST_LIMIT,
    select: {
      kind: true,
      content: true,
      status: true,
      sourceAt: true,
      updatedAt: true,
      notionStatus: true,
      notionCheckedAt: true,
    },
  });

  return formatMemoryBlock(memories, now);
}

/** 抽出した候補を足す。同じ内容（忘れた・見送ったものを含む）は足さない。足した件数を返す。 */
export async function addCandidates(userId: string, candidates: ParsedCandidate[]): Promise<number> {
  if (candidates.length === 0) return 0;

  const result = await db.memory.createMany({
    data: candidates.map((candidate) => ({ userId, ...candidate })),
    skipDuplicates: true,
  });

  return result.count;
}

/**
 * 利用者の操作を受ける。**必ず `userId` との組で引く**（他人の記憶を動かせない）。
 * 遷移元を `where` に含めて1文で書くので、同時に押されても二重に遷移しない。
 */
export async function applyMemoryAction(
  userId: string,
  id: string,
  action: MemoryAction,
  content?: string,
): Promise<MemoryActionResult> {
  const now = new Date();

  if (action === "edit") {
    const next = (content ?? "").trim();
    if (next === "") return { ok: false, error: "内容を入力してください。", status: 400 };
    if (Array.from(next).length > MEMORY_CONTENT_MAX) {
      return { ok: false, error: `内容は${MEMORY_CONTENT_MAX}文字までです。`, status: 400 };
    }
    if (containsSecret(next)) {
      return { ok: false, error: "パスワードやトークンなどの秘密情報は記憶に残せません。", status: 400 };
    }

    try {
      const updated = await db.memory.updateMany({
        where: { id, userId, status: { in: ["CANDIDATE", "CONFIRMED"] } },
        data: {
          content: next,
          dedupeKey: dedupeKeyOf(next),
          // 直した内容は、以前のNotionの照合結果とは別物として扱う。
          notionStatus: null,
          notionUrl: null,
          notionCheckedAt: null,
        },
      });
      return updated.count === 0 ? notFound() : { ok: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { ok: false, error: "同じ内容の記憶がすでにあります。", status: 409 };
      }
      throw error;
    }
  }

  const transitions = {
    confirm: { from: "CANDIDATE", data: { status: "CONFIRMED", confirmedAt: now } },
    dismiss: { from: "CANDIDATE", data: { status: "DISMISSED" } },
    forget: { from: "CONFIRMED", data: { status: "FORGOTTEN" } },
  } as const;
  const transition = transitions[action];

  const updated = await db.memory.updateMany({
    where: { id, userId, status: transition.from },
    data: transition.data,
  });

  return updated.count === 0 ? notFound() : { ok: true };
}

function notFound(): MemoryActionResult {
  return { ok: false, error: "対象の記憶が見つからないか、すでに操作済みです。", status: 404 };
}

/** Notionの照合結果を保存する。 */
export async function saveNotionResults(
  userId: string,
  results: Map<string, NotionCheckResult>,
  checkedAt: Date,
): Promise<void> {
  for (const [id, result] of results) {
    await db.memory.updateMany({
      where: { id, userId, status: "CONFIRMED", kind: "WISH" },
      data: {
        notionStatus: result.status,
        // 見つからなかった回は、前に分かっていたリンクを消す（別の項目のリンクを残さない）。
        notionUrl: result.status === "not_found" ? null : (result.url ?? undefined),
        notionCheckedAt: checkedAt,
      },
    });
  }
}
