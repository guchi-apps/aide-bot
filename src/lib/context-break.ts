import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { shouldAutoBreak, type ContextBreakKind } from "@/lib/context-break-rule";

/**
 * 会話の区切り（#322）。**サーバー専用。**
 *
 * 1本の `Conversation` は保ったまま、**モデルへ渡す文脈の起点**（`contextStartedAt`）だけを
 * 進める。履歴の窓・要約・`summarizedCount` はこの時刻以降の発言だけを対象にし、それ以前の
 * 発言・書き込みの記録・通知・使用量は消さない（日別の記録からそのまま読める）。
 * 起点を時刻で持つのは、発言を作る経路（相談・朝の見通し・お知らせ・声かけ）のどれにも
 * 世代を渡さずに済ませるため——渡し忘れた発言が履歴から消える形にならない。
 */

/** 文脈の起点と、その上に載る要約。 */
export type ContextSnapshot = {
  summary: string | null;
  summarizedCount: number;
  contextStartedAt: Date | null;
  lastUserMessageAt: Date | null;
};

const SNAPSHOT_SELECT = {
  summary: true,
  summarizedCount: true,
  contextStartedAt: true,
  lastUserMessageAt: true,
} as const;

/** 現在の文脈に属する発言の条件。履歴・件数・compactが同じ関数を通る。 */
export function contextMessageWhere(
  conversationId: string,
  contextStartedAt: Date | null,
): Prisma.MessageWhereInput {
  return contextStartedAt === null
    ? { conversationId }
    : { conversationId, createdAt: { gte: contextStartedAt } };
}

async function readSnapshot(conversationId: string): Promise<ContextSnapshot | null> {
  return db.conversation.findUnique({ where: { id: conversationId }, select: SNAPSHOT_SELECT });
}

/**
 * 起点を `now` へ進める。**読んだ起点のままのときだけ書く**（CAS）ので、二重押し・自動と手動の
 * 同時実行で区切りが2つ入らない。要約と件数も同じトランザクションで捨てる。
 *
 * compact（`compact.ts`）も書き込みのCASに起点を含めているので、区切りをまたいで走っていた
 * 要約が、新しい文脈へ古い話を書き込むことは無い。
 */
async function applyBreak(
  conversationId: string,
  kind: ContextBreakKind,
  now: Date,
  expectedStartedAt: Date | null,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const updated = await tx.conversation.updateMany({
      where: { id: conversationId, contextStartedAt: expectedStartedAt },
      data: { contextStartedAt: now, summary: null, summarizedCount: 0 },
    });
    if (updated.count === 0) return false;

    await tx.contextBreak.create({ data: { conversationId, at: now, kind } });
    return true;
  });
}

/**
 * 無操作のまま日をまたいでいたら、自動で区切る（判定は `shouldAutoBreak()`）。
 * 区切った後の最新の状態を返す。
 *
 * **利用者の発言を保存する前と、秘書の側が発言を積む前（朝の見通し・お知らせ・声かけ）の
 * 両方で呼ぶ。** 後者で呼ぶのは、朝の見通しが古い文脈へ入って、区切った後の会話から
 * 見えなくなるのを避けるため。
 */
export async function rolloverIfIdle(conversationId: string, now: Date): Promise<ContextSnapshot | null> {
  const snapshot = await readSnapshot(conversationId);
  if (!snapshot) return null;

  if (!shouldAutoBreak({ ...snapshot, now })) return snapshot;

  if (await applyBreak(conversationId, "AUTO", now, snapshot.contextStartedAt)) {
    return readSnapshot(conversationId);
  }

  // 同時に来た別の経路が先に区切った。その結果をそのまま使う。
  return readSnapshot(conversationId);
}

/**
 * 利用者が押した区切り。現在の文脈にまだ発言が無ければ何もしない（連打で区切り線が並ばない）。
 * 区切ったときだけ、その時刻を返す。
 */
export async function breakContextManually(conversationId: string, now: Date): Promise<Date | null> {
  const snapshot = await readSnapshot(conversationId);
  if (!snapshot) return null;

  const count = await db.message.count({ where: contextMessageWhere(conversationId, snapshot.contextStartedAt) });
  if (count === 0) return null;

  return (await applyBreak(conversationId, "MANUAL", now, snapshot.contextStartedAt)) ? now : null;
}

/**
 * 返答を保存するときの時刻。**往復の途中で区切られていたら、区切りの1ms前にする。**
 *
 * 返答は利用者の発言（区切り前の文脈）に対するものなので、区切り後の時刻で保存すると
 * 新しい文脈の先頭へ入り、古い話を新しい会話へ持ち込む。1ms前なら旧文脈に残り、
 * 画面の並びも区切り線の手前に収まる。
 */
export async function replySavedAt(
  conversationId: string,
  turnContextStartedAt: Date | null,
): Promise<Date> {
  const current = await db.conversation.findUnique({
    where: { id: conversationId },
    select: { contextStartedAt: true },
  });

  const startedAt = current?.contextStartedAt ?? null;
  const changed = (startedAt?.getTime() ?? null) !== (turnContextStartedAt?.getTime() ?? null);

  return changed && startedAt ? new Date(startedAt.getTime() - 1) : new Date();
}
