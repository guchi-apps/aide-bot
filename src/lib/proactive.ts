import { PROACTIVE_REQUEST, proactiveSystemPrompt } from "@/lib/anthropic";
import { BRIEFING_MODEL } from "@/lib/chat-model";
import { runCodexRecorded } from "@/lib/codex-run";
import { dayStart, jstDayKey } from "@/lib/day-key";
import { appendSecretaryExchange, primaryConversation } from "@/lib/day-log";
import { db } from "@/lib/db";
import { listConnectedServers, toCodexMcpServers } from "@/lib/mcp/connections";
import { findPreset } from "@/lib/mcp/presets";
import {
  PROACTIVE_NOTIFICATION_KIND,
  candidateFromDedupeKey,
  jstWeekKey,
  parseProactiveReply,
  proactiveDedupeKey,
  proactiveGate,
} from "@/lib/proactive-rule";
import { normalizeFrequency, type ProactiveSettings } from "@/lib/proactive-labels";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";

/**
 * 先回りの提案（#325）。**サーバー専用。**
 *
 * 予定・タスク・Notionの希望を見て、「今ならできる」「そろそろ対応したい」を秘書の方から
 * Web Pushで伝える。起点は朝の見通しと同じcron（`/api/briefing` の末尾から `after()` で呼ぶ。
 * 新しいエンドポイントもVPSのcrontabの変更も要らない）。
 *
 * ## 読まれなくなる通知を作らない（#79と同じ考え方）
 *
 * - **モデルを呼ぶ前にDBの値だけで弾く**（`proactiveGate()`）。静音・勤務帯・種類オフ・上限・
 *   前回の判定からの間隔。1回がCodex＋MCPで重いので、cronが30分ごとに叩いても呼ぶのは条件が
 *   揃った回だけ
 * - **黙れる。** 材料が揃わない回・取得に失敗した回・理由が無い回は `NO_SUGGESTION`。**取得失敗を
 *   「何もない」と解釈して提案しない**（指示と、返答の読み取りの両方で塞ぐ）
 * - **同じものを繰り返さない。** `NotificationLog` の一意制約（同じ週・種類・候補・予定状態）と、
 *   最近伝えた候補の名前を次の判定へ渡すこと。候補の状態や予定が変われば鍵が変わって判定し直す
 * - **書き込みの道具は常に止める。** 通知の内容で予定・タスクを自動登録しない。押した後の相談は
 *   現在の値を読み直す（#324）ので、古い通知の内容で何かが書かれることも無い
 * - 朝の見通し（`morning-briefing`）・急ぎのお知らせ（`urgent-notice`）とは `kind` を分けてあり、
 *   その1日1本の枠を消費しない。**急ぎ（#115）はこの上限・静音の対象外**（別の経路のまま）
 */

const PROACTIVE_TITLE = "先回りの提案";

/** Codexを待つ上限。誰も画面の前で待っていないので朝の見通し（180秒）と同じ。 */
const CODEX_TIMEOUT_MS = 180 * 1000;

/** 「最近伝えた候補」を遡る日数。 */
const RECENT_DAYS = 14;

export type ProactiveOutcome = {
  userId: string;
  status: "sent" | "silent" | "skipped" | "failed";
  delivered: number;
  detail?: string;
};

/** いま判定している利用者。二重に走ると同じ提案を2件送りうる（`compact.ts` の `running` と同じ前提）。 */
const inFlight = new Set<string>();

type ProactiveUser = ProactiveSettings & { id: string; checkedAt: Date | null };

function toSettings(row: {
  proactiveWeekend: boolean;
  proactiveFreeTime: boolean;
  proactiveOngoing: boolean;
  proactiveQuietStart: number;
  proactiveQuietEnd: number;
  proactiveAvoidWork: boolean;
  proactiveFrequency: string;
}): ProactiveSettings {
  return {
    weekend: row.proactiveWeekend,
    freeTime: row.proactiveFreeTime,
    ongoing: row.proactiveOngoing,
    quietStart: row.proactiveQuietStart,
    quietEnd: row.proactiveQuietEnd,
    avoidWork: row.proactiveAvoidWork,
    frequency: normalizeFrequency(row.proactiveFrequency),
  };
}

async function runFor(user: ProactiveUser, now: Date): Promise<ProactiveOutcome> {
  const { id: userId } = user;

  const [sentToday, sentThisWeek] = await Promise.all([
    db.notificationLog.count({
      where: { userId, kind: PROACTIVE_NOTIFICATION_KIND, createdAt: { gte: dayStart(jstDayKey(now)) } },
    }),
    db.notificationLog.count({
      where: { userId, kind: PROACTIVE_NOTIFICATION_KIND, createdAt: { gte: dayStart(jstWeekKey(now)) } },
    }),
  ]);

  const gate = proactiveGate({ now, settings: user, sentToday, sentThisWeek, lastCheckedAt: user.checkedAt });
  if (!gate.run) return { userId, status: "skipped", delivered: 0, detail: gate.reason };

  // 材料はNotion（希望）とAIDE（予定・用件）の両方から取る。片方が無ければ判定できない。
  // 「空いているかどうか」を確かめられないまま提案しない。
  const servers = await listConnectedServers(userId);
  const hasNotion = servers.some((server) => findPreset(server.url)?.id === "notion");
  const hasAide = servers.some((server) => findPreset(server.url)?.id === "aide");
  if (!hasNotion || !hasAide) {
    return { userId, status: "skipped", delivered: 0, detail: "NotionかAIDEに繋がっていない" };
  }

  // **判定を試みた時刻はモデルを呼ぶ前に進める。** 失敗した回も間隔をあけないと、Notionや
  // AIDEが不調なあいだcronのたびに重い呼び出しを繰り返す。
  await db.user.update({ where: { id: userId }, data: { proactiveCheckedAt: now } });

  const recent = await db.notificationLog.findMany({
    where: {
      userId,
      kind: PROACTIVE_NOTIFICATION_KIND,
      createdAt: { gte: new Date(now.getTime() - RECENT_DAYS * 86_400_000) },
    },
    select: { dedupeKey: true },
  });
  const recentCandidates = [
    ...new Set(recent.map((row) => candidateFromDedupeKey(row.dedupeKey)).filter((name): name is string => name !== null)),
  ];

  let answer: string;
  try {
    // **書き込みの道具は設定によらず常に止める**（朝の見通しと同じ。確かめる相手がいない）。
    const { mcpServers } = toCodexMcpServers(servers, false);

    const result = await runCodexRecorded({
      userId,
      feature: "proactive",
      label: "先回りの提案の生成",
      model: BRIEFING_MODEL,
      prompt: [proactiveSystemPrompt({ kinds: gate.kinds, recentCandidates, now }), "---", PROACTIVE_REQUEST].join(
        "\n\n",
      ),
      timeoutMs: CODEX_TIMEOUT_MS,
      mcpServers,
    });

    // `text` ではなく `reply`。道具を呼んだ回の前置きを通知の本文にしない（#131）。
    answer = result.reply.trim();
  } catch (error) {
    // 失敗は「提案なし」と区別する。何も送らず、次の判定は間隔をあけてやり直す。
    console.error("[aide-bot] 先回りの提案の生成に失敗した", error);
    return {
      userId,
      status: "failed",
      delivered: 0,
      detail: error instanceof Error ? error.message : "不明なエラー",
    };
  }

  const suggestion = parseProactiveReply(answer, gate.kinds);
  if (!suggestion) return { userId, status: "silent", delivered: 0 };

  if (recentCandidates.includes(suggestion.candidate)) {
    return { userId, status: "silent", delivered: 0, detail: "最近伝えた候補" };
  }

  const dedupeKey = proactiveDedupeKey(suggestion, now);
  const existing = await db.notificationLog.findUnique({
    where: { userId_kind_dedupeKey: { userId, kind: PROACTIVE_NOTIFICATION_KIND, dedupeKey } },
    select: { id: true },
  });
  if (existing) return { userId, status: "silent", delivered: 0, detail: "送信済みの提案" };

  // 連続セッションへ追記する（#157）。1通目は依頼（USER）で、記録の画面には出ない（#280）。
  // 押した先（`/`）は今日の記録で、開けば提案がいちばん下にある。時刻は書き込む直前に取り直す（#261）。
  const conversation = await primaryConversation(userId);
  await appendSecretaryExchange(conversation.id, PROACTIVE_REQUEST, suggestion.text, new Date());

  const delivered = await sendPushToUser(userId, {
    title: PROACTIVE_TITLE,
    body: suggestion.text,
    url: "/",
    tag: PROACTIVE_NOTIFICATION_KIND,
  });

  await db.notificationLog.create({
    data: {
      userId,
      kind: PROACTIVE_NOTIFICATION_KIND,
      dedupeKey,
      title: PROACTIVE_TITLE,
      body: suggestion.text,
      conversationId: conversation.id,
      deliveredCount: delivered,
    },
  });

  return { userId, status: "sent", delivered };
}

/**
 * 購読している利用者全員について、提案してよいか判定し、あれば届ける。
 *
 * **1人が失敗しても他は続ける。** 例外は外へ出さない（呼び出し元は `after()`）。
 */
export async function runProactiveSuggestions(now = new Date()): Promise<ProactiveOutcome[]> {
  const userIds = await usersWithSubscriptions();
  const rows = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      proactiveWeekend: true,
      proactiveFreeTime: true,
      proactiveOngoing: true,
      proactiveQuietStart: true,
      proactiveQuietEnd: true,
      proactiveAvoidWork: true,
      proactiveFrequency: true,
      proactiveCheckedAt: true,
    },
  });

  const outcomes: ProactiveOutcome[] = [];

  for (const row of rows) {
    if (inFlight.has(row.id)) {
      outcomes.push({ userId: row.id, status: "skipped", delivered: 0, detail: "判定中" });
      continue;
    }

    inFlight.add(row.id);
    try {
      outcomes.push(await runFor({ id: row.id, checkedAt: row.proactiveCheckedAt, ...toSettings(row) }, now));
    } catch (error) {
      console.error(`[aide-bot] 先回りの提案の処理に失敗した: ${row.id}`, error);
      outcomes.push({
        userId: row.id,
        status: "failed",
        delivered: 0,
        detail: error instanceof Error ? error.message : "不明なエラー",
      });
    } finally {
      inFlight.delete(row.id);
    }
  }

  return outcomes;
}
