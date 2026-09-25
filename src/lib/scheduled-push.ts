import { db } from "@/lib/db";
import {
  SCHEDULED_PUSH_KIND,
  SCHEDULED_PUSH_TOPIC_LIMIT,
  composeScheduledBody,
  isDue,
  scheduledDedupeKey,
} from "@/lib/scheduled-push-rule";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";
import { topicCategoryShort } from "@/lib/topic-categories";
import { topicsForScheduledPush } from "@/lib/topics";

/**
 * 定時のお知らせ（#344）。**サーバー専用。** 起点は朝の見通しと同じcron（`/api/briefing` の末尾）。
 *
 * - **モデルは呼ばない。** 仕入れ済みの話題（`Topic`。24時間以内）の見出しをそのまま送る
 * - **黙れる。** 話題が0件の回は送らず、記録も残さない（猶予の3時間内に仕入れられれば、次の起動で届く）
 * - **同じ日・同じ設定で二度送らない。** `NotificationLog` の一意制約（`<日付>:<設定id>`）。
 *   朝の見通し・急ぎ・先回りの提案とは `kind` を分けてあり、その枠を消費しない
 * - **送った話題には `Topic.spokenAt` を付け、次からは選ばない**（声かけ・別の定時との二重出しを避ける）
 * - 押した先は「話題」ページ（`/topics`）。相談の記録へは積まない（会話の最中へ割り込むため。#278の錠を再実装しない）
 */

export type ScheduledPushOutcome = {
  userId: string;
  scheduleId: string;
  status: "sent" | "silent" | "skipped" | "failed";
  delivered: number;
  detail?: string;
};

/** 処理中の設定。cronが重なっても二重に送らない（`compact.ts` の `running` と同じ前提）。 */
const inFlight = new Set<string>();

export async function runScheduledPushes(now = new Date()): Promise<ScheduledPushOutcome[]> {
  const userIds = await usersWithSubscriptions();
  if (userIds.length === 0) return [];

  const schedules = await db.scheduledPush.findMany({
    where: { userId: { in: userIds }, enabled: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const outcomes: ScheduledPushOutcome[] = [];

  for (const schedule of schedules) {
    if (!isDue(schedule, now)) continue;

    const base = { userId: schedule.userId, scheduleId: schedule.id };
    if (inFlight.has(schedule.id)) {
      outcomes.push({ ...base, status: "skipped", delivered: 0, detail: "送信中" });
      continue;
    }

    inFlight.add(schedule.id);
    try {
      const dedupeKey = scheduledDedupeKey(schedule.id, now);
      const existing = await db.notificationLog.findUnique({
        where: { userId_kind_dedupeKey: { userId: schedule.userId, kind: SCHEDULED_PUSH_KIND, dedupeKey } },
        select: { id: true },
      });
      if (existing) {
        outcomes.push({ ...base, status: "skipped", delivered: 0, detail: "送信済み" });
        continue;
      }

      const topics = await topicsForScheduledPush(schedule.userId, schedule.category, SCHEDULED_PUSH_TOPIC_LIMIT, now);
      if (topics.length === 0) {
        outcomes.push({ ...base, status: "silent", delivered: 0, detail: "届ける話題がない" });
        continue;
      }

      const title = `定時のお知らせ（${schedule.category === "all" ? "話題" : topicCategoryShort(schedule.category)}）`;
      const body = composeScheduledBody(topics.map((topic) => topic.title));

      const delivered = await sendPushToUser(schedule.userId, {
        title,
        body,
        url: "/topics",
        tag: `${SCHEDULED_PUSH_KIND}:${schedule.id}`,
      });

      await db.notificationLog.create({
        data: { userId: schedule.userId, kind: SCHEDULED_PUSH_KIND, dedupeKey, title, body, deliveredCount: delivered },
      });

      // 送った話題に印を付ける。声かけ（#278）や別の定時が同じ話題をもう一度出さないため。
      await db.topic.updateMany({ where: { id: { in: topics.map((topic) => topic.id) } }, data: { spokenAt: now } });

      outcomes.push({ ...base, status: "sent", delivered });
    } catch (error) {
      console.error(`[aide-bot] 定時のお知らせに失敗した: ${schedule.id}`, error);
      outcomes.push({
        ...base,
        status: "failed",
        delivered: 0,
        detail: error instanceof Error ? error.message : "不明なエラー",
      });
    } finally {
      inFlight.delete(schedule.id);
    }
  }

  return outcomes;
}
