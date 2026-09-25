import type { TopicCategory as TopicCategoryRow } from "@prisma/client";

import { db } from "@/lib/db";
import {
  MAX_TOPIC_CATEGORIES,
  initialTopicCategories,
  newTopicCategoryId,
  type TopicCategory,
  type TopicCategoryFields,
} from "@/lib/topic-categories";

/**
 * 話題の種類（#345）のDBの読み書き。**サーバー専用。**
 *
 * 初期の3種類は、その利用者が初めて読んだときに投入する（マイグレーションでは入れない。
 * 利用者行が後から増えても同じ経路で入る）。**入れたかどうかは `User.topicCategoriesReady` の
 * CAS（`updateMany`）で決める**——2つの問い合わせが重なっても片方だけが入れる。移行元の
 * `User.topicCategories` は、この初回にだけ読んで3種類のオン・オフを引き継ぐ。
 */

function toCategory(row: TopicCategoryRow): TopicCategory {
  return { id: row.key, label: row.label, short: row.short, scope: row.scope, enabled: row.enabled };
}

async function ensureInitialized(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { topicCategoriesReady: true, topicCategories: true },
  });
  if (!user || user.topicCategoriesReady) return;

  await db.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: userId, topicCategoriesReady: false },
      data: { topicCategoriesReady: true },
    });
    if (claimed.count === 0) return; // 別の問い合わせが先に入れた。

    await tx.topicCategory.createMany({
      data: initialTopicCategories(user.topicCategories).map((category, index) => ({
        userId,
        key: category.id,
        label: category.label,
        short: category.short,
        scope: category.scope,
        enabled: category.enabled,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
  });
}

/** 利用者の種類を並び順で返す（無効のものも含む）。 */
export async function listTopicCategories(userId: string): Promise<TopicCategory[]> {
  await ensureInitialized(userId);
  const rows = await db.topicCategory.findMany({
    where: { userId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toCategory);
}

export type CategoryMutation =
  | { ok: true; category: TopicCategory }
  | { ok: false; error: string; status: 400 | 404 };

/** 種類を追加する。上限を超える場合は断る。 */
export async function addTopicCategory(userId: string, fields: TopicCategoryFields): Promise<CategoryMutation> {
  await ensureInitialized(userId);

  const existing = await db.topicCategory.findMany({ where: { userId }, select: { sortOrder: true } });
  if (existing.length >= MAX_TOPIC_CATEGORIES) {
    return { ok: false, status: 400, error: `種類は${MAX_TOPIC_CATEGORIES}件までです。不要なものを削除してください。` };
  }

  const row = await db.topicCategory.create({
    data: {
      userId,
      key: newTopicCategoryId(),
      ...fields,
      enabled: true,
      sortOrder: existing.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
    },
  });
  return { ok: true, category: toCategory(row) };
}

/** 名前・説明の編集、またはオン・オフの切り替え。`id` は `key`。 */
export async function updateTopicCategory(
  userId: string,
  key: string,
  patch: Partial<TopicCategoryFields> & { enabled?: boolean },
): Promise<CategoryMutation> {
  // 他人の行は `userId` との組で引く（キーだけで更新しない）。
  const result = await db.topicCategory.updateMany({ where: { userId, key }, data: patch });
  if (result.count === 0) return { ok: false, status: 404, error: "その種類が見つかりません。" };

  const row = await db.topicCategory.findUniqueOrThrow({ where: { userId_key: { userId, key } } });
  return { ok: true, category: toCategory(row) };
}

/** 種類を削除する。仕入れ済みの記事（`Topic`）は残す（チップは「その他」になる）。 */
export async function deleteTopicCategory(userId: string, key: string): Promise<boolean> {
  const result = await db.topicCategory.deleteMany({ where: { userId, key } });
  return result.count > 0;
}
