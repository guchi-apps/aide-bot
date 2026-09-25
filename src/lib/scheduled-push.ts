import { db } from "@/lib/db";
import {
  SCHEDULED_PUSH_ALL,
  SCHEDULED_PUSH_KIND,
  SCHEDULED_PUSH_TOPIC_LIMIT,
  composeScheduledBody,
  isDue,
  scheduledDedupeKey,
} from "@/lib/scheduled-push-rule";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";
import { topicCategoryShort } from "@/lib/topic-categories";
import { listTopicCategories } from "@/lib/topic-category-store";
import { refreshTopicsForSchedule, topicsForScheduledPush } from "@/lib/topics";

/**
 * 定時のお知らせ（#344）。**サーバー専用。** 起点は朝の見通しと同じcron（`/api/briefing` の末尾）。
 *
 * - **送る前にニュースを仕入れる**（#362。`refreshTopicsForSchedule()`）。送信対象の設定があり、まだ
 *   送っていない回だけ。30分以内に仕入れ済みなら省く。失敗・実行中でも、溜まっている話題があれば送る
 * - **文面はモデルに書かせない。** 仕入れ済みの話題（`Topic`。24時間以内）の見出しをそのまま送る
 *   （仕入れそのものはCodexの検索を使う）。同じ出来事の記事は1件にまとめる
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

  // 送る前にニュースを仕入れる（#362）。**配信のループの外で、利用者ごとに1回・並行して待つ**——ループの中で
  // 待つと、仕入れ1回（最大150秒）のあいだ後ろに並ぶ設定（ほかの利用者の分も）の配信が止まる。
  // 仕入れは利用者単位の錠を共有するので、設定ごとに呼ぶ必要もない。対象は、いま送る時間で、今日の分を
  // まだ送っていない設定を持つ利用者だけ（送信済みの日に仕入れを走らせない）。失敗・実行中でも止めず、
  // 溜まっている話題で送る。時刻より前のcronで仕入れる案は、猶予（3時間）内で一番早い起動に合わせられず
  // 仕入れの古さが読めなくなるため採らなかった（遅れは最大で仕入れ1回ぶん）。
  const dueSchedules = schedules.filter((schedule) => isDue(schedule, now));
  const sentKeys = new Set(
    (
      await db.notificationLog.findMany({
        where: {
          kind: SCHEDULED_PUSH_KIND,
          dedupeKey: { in: dueSchedules.map((schedule) => scheduledDedupeKey(schedule.id, now)) },
        },
        select: { dedupeKey: true },
      })
    ).map((log) => log.dedupeKey),
  );
  const refreshUserIds = [
    ...new Set(
      dueSchedules.filter((schedule) => !sentKeys.has(scheduledDedupeKey(schedule.id, now))).map((schedule) => schedule.userId),
    ),
  ];
  await Promise.all(
    refreshUserIds.map(async (userId) => {
      const refreshed = await refreshTopicsForSchedule(userId, now);
      if (refreshed === "failed" || refreshed === "busy") {
        console.warn(`[aide-bot] 定時のお知らせの前の仕入れは${refreshed}: 溜まっている話題で送る`);
      }
    }),
  );

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

      const label =
        schedule.category === SCHEDULED_PUSH_ALL
          ? "話題"
          : topicCategoryShort(await listTopicCategories(schedule.userId), schedule.category);
      const title = `定時のお知らせ（${label}）`;
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
      // まとめた記事も同じ話なので、グループ全体に付ける（#362）。
      await db.topic.updateMany({ where: { id: { in: topics.flatMap((topic) => topic.mergedIds) } }, data: { spokenAt: now } });

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
