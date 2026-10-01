import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { SCHEDULED_PUSH_ALL, SCHEDULED_PUSH_LIMIT, daysToMask } from "@/lib/scheduled-push-rule";
import type { ScheduledPushTarget, SettingsChange } from "@/lib/settings-proposal";
import { MAX_TOPIC_CATEGORIES, newTopicCategoryId } from "@/lib/topic-categories";
import { listTopicCategories } from "@/lib/topic-category-store";

/** 反映できなかった理由（利用者へそのまま見せる）。1件でも失敗したら全体を巻き戻す。 */
export class SettingsApplyError extends Error {}

type Tx = Prisma.TransactionClient;

type CategoryRow = { key: string; label: string; short: string };

function matchCategory(rows: CategoryRow[], name: string): CategoryRow {
  const hits = rows.filter((row) => row.label === name || row.short === name);
  if (hits.length === 0) throw new SettingsApplyError(`「${name}」という種類が見つかりません。`);
  if (hits.length > 1) throw new SettingsApplyError(`「${name}」に当てはまる種類が複数あります。設定の画面から変更してください。`);
  return hits[0];
}

/** 定時の設定が指す種類（`all` か名前）を `category` の値（`all` か種類の `key`）へ解決する。 */
function resolveCategoryKey(rows: CategoryRow[], name: string): string {
  return name === SCHEDULED_PUSH_ALL ? SCHEDULED_PUSH_ALL : matchCategory(rows, name).key;
}

async function applyTopicCategory(
  tx: Tx,
  userId: string,
  change: Extract<SettingsChange, { key: "topic_category" }>,
): Promise<void> {
  // 初期の3種類の投入（`listTopicCategories()`）を済ませてからトランザクション内で読み直す。
  const rows = await tx.topicCategory.findMany({ where: { userId }, orderBy: { sortOrder: "asc" } });

  if (change.action === "add") {
    // 押し直しても二重に増えない（同じ名前が既にあれば何もしない）。
    if (rows.some((row) => row.label === change.label)) return;
    if (rows.length >= MAX_TOPIC_CATEGORIES) {
      throw new SettingsApplyError(`種類は${MAX_TOPIC_CATEGORIES}件までです。不要なものを削除してください。`);
    }
    await tx.topicCategory.create({
      data: {
        userId,
        key: newTopicCategoryId(),
        label: change.label,
        short: change.short,
        scope: change.scope,
        enabled: true,
        sortOrder: rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1,
      },
    });
    return;
  }

  const row = matchCategory(rows, change.target);
  if (change.action === "delete") {
    // 仕入れ済みの記事（`Topic`）は残す（チップは「その他」になる）。
    await tx.topicCategory.deleteMany({ where: { userId, key: row.key } });
    return;
  }
  const patch: Prisma.TopicCategoryUpdateManyMutationInput = {};
  if (change.label !== undefined) patch.label = change.label;
  if (change.short !== undefined) patch.short = change.short;
  if (change.scope !== undefined) patch.scope = change.scope;
  if (change.enabled !== undefined) patch.enabled = change.enabled;
  await tx.topicCategory.updateMany({ where: { userId, key: row.key }, data: patch });
}

function matchesTarget(
  row: { daysMask: number; hour: number; minute: number; category: string },
  target: ScheduledPushTarget,
  categoryKey: string | undefined,
): boolean {
  return (
    (target.days === undefined || row.daysMask === daysToMask(target.days)) &&
    (target.hour === undefined || row.hour === target.hour) &&
    (target.minute === undefined || row.minute === target.minute) &&
    (categoryKey === undefined || row.category === categoryKey)
  );
}

async function applyScheduledPush(
  tx: Tx,
  userId: string,
  change: Extract<SettingsChange, { key: "scheduled_push" }>,
  categories: CategoryRow[],
): Promise<void> {
  if (change.action === "add") {
    const existing = await tx.scheduledPush.findMany({ where: { userId } });
    const category = resolveCategoryKey(categories, change.category);
    // 押し直しても二重に増えない（同じ曜日・時刻・種類があれば何もしない）。
    if (
      existing.some(
        (row) =>
          row.daysMask === daysToMask(change.days) &&
          row.hour === change.hour &&
          row.minute === change.minute &&
          row.category === category,
      )
    ) {
      return;
    }
    if (existing.length >= SCHEDULED_PUSH_LIMIT) {
      throw new SettingsApplyError(`定時のお知らせは${SCHEDULED_PUSH_LIMIT}件までです。不要なものを削除してください。`);
    }
    await tx.scheduledPush.create({
      data: {
        userId,
        daysMask: daysToMask(change.days),
        hour: change.hour,
        minute: change.minute,
        category,
        enabled: change.enabled ?? true,
      },
    });
    return;
  }

  const categoryKey = change.target.category === undefined ? undefined : resolveCategoryKey(categories, change.target.category);
  const rows = await tx.scheduledPush.findMany({ where: { userId } });
  const hits = rows.filter((row) => matchesTarget(row, change.target, categoryKey));
  if (hits.length === 0) throw new SettingsApplyError("指定された定時のお知らせが見つかりません。");
  if (hits.length > 1) {
    throw new SettingsApplyError("指定に当てはまる定時のお知らせが複数あります。設定の画面から変更してください。");
  }
  const [row] = hits;

  if (change.action === "delete") {
    await tx.scheduledPush.deleteMany({ where: { id: row.id, userId } });
    return;
  }

  const data: Prisma.ScheduledPushUpdateManyMutationInput = {};
  if (change.days !== undefined) data.daysMask = daysToMask(change.days);
  if (change.hour !== undefined) data.hour = change.hour;
  if (change.minute !== undefined) data.minute = change.minute;
  if (change.category !== undefined) data.category = resolveCategoryKey(categories, change.category);
  if (change.enabled !== undefined) data.enabled = change.enabled;
  // 曜日・時刻を変えたら登録時刻を取り直す（過ぎた時刻の分が発火しないように。`api/settings/scheduled-push` と同じ）。
  if (change.days !== undefined || change.hour !== undefined || change.minute !== undefined) {
    data.createdAt = new Date();
  }
  await tx.scheduledPush.updateMany({ where: { id: row.id, userId }, data });
}

/**
 * 検証済みの設定変更をDBへ反映する（#346・#352）。**呼ぶのは利用者が「変更する」を押した入口だけ**。
 * 書く列・規則は設定の画面と同じ（`api/settings/*`）。**1件でも失敗したら全体を巻き戻し**、
 * 理由を `SettingsApplyError` で投げる。追加は同じ内容が既にあれば何もしない（押し直しても二重に増えない）。
 */
export async function applySettingsChanges(userId: string, changes: SettingsChange[]): Promise<void> {
  // 種類の初期投入（初回だけ書く）はトランザクションの外で済ませる。
  if (changes.some((change) => change.key === "topic_category" || change.key === "scheduled_push")) {
    await listTopicCategories(userId);
  }

  await db.$transaction(async (tx) => {
    const data: Record<string, number | boolean | string> = {};

    for (const change of changes) {
      if (change.key === "briefing_time") {
        data.briefingHour = change.hour;
        data.briefingMinute = change.minute;
        continue;
      }
      if (change.key === "topic_category") {
        await applyTopicCategory(tx, userId, change);
        continue;
      }
      if (change.key === "scheduled_push") {
        // 同じ案の中で種類を足した直後でも解決できるよう、都度読む。
        const categories = await tx.topicCategory.findMany({ where: { userId } });
        await applyScheduledPush(tx, userId, change, categories);
        continue;
      }
      if (change.weekend !== undefined) data.proactiveWeekend = change.weekend;
      if (change.freeTime !== undefined) data.proactiveFreeTime = change.freeTime;
      if (change.ongoing !== undefined) data.proactiveOngoing = change.ongoing;
      if (change.avoidWork !== undefined) data.proactiveAvoidWork = change.avoidWork;
      if (change.quietStart !== undefined) data.proactiveQuietStart = change.quietStart;
      if (change.quietEnd !== undefined) data.proactiveQuietEnd = change.quietEnd;
      if (change.frequency !== undefined) data.proactiveFrequency = change.frequency;
    }

    if (Object.keys(data).length > 0) {
      await tx.user.update({ where: { id: userId }, data });
    }
  });
}
