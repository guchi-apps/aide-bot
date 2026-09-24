import { Prisma } from "@prisma/client";
import { cache } from "react";

import type { ChatEntry } from "@/components/chat/types";
import { dayEnd, dayHeading, dayStart, jstDayKey, jstTimeLabel, monthLabel } from "@/lib/day-key";
import { db } from "@/lib/db";

/**
 * 連続セッションと、その日ごとの取り出し（#157）。**サーバー専用**（Prismaを引き込む）。
 *
 * 相談は話題ごとに分けず、利用者につき1本の `Conversation` へ積み続ける。分け目は
 * 日付だけで、これは**表示の都合**でしかない——DBの上では1本の並びのままにしてある。
 * 日をまたいで話が続くのが普通なので、日ごとにスレッドを切ると「きのうの続き」を
 * モデルへ渡すのに結局またぐことになる。
 *
 * 日付の組み立て（鍵・見出し）は `src/lib/day-key.ts` に分けてある。記録の画面
 * （`EntryList`）がクライアントコンポーネントで、Prismaを引き込めないため。
 */

/** 連続セッションの見出し。画面には出ないが、`Conversation.title` は必須のため入れる。 */
export const PRIMARY_CONVERSATION_TITLE = "秘書との記録";

/** 左メニューに並べる日数の上限。これより古い日は、いまのところ辿る導線を持たない。 */
const DAY_LIST_LIMIT = 180;

/**
 * 「今日」の画面に、きのう以前から続けて出す発言の最小数。
 *
 * 日付で切るのは見出しを付けるためで、話の流れまで切るためではない。今日まだ一言も
 * 話していない朝に空の画面が出ると、**連続セッションなのに毎朝リセットされたように見える。**
 */
const CARRY_OVER_MIN_ENTRIES = 8;

/**
 * 連続セッションを取り出す。無ければ作る（#157）。
 *
 * **1利用者につき1本**。`(userId, isPrimary)` には一意制約が無い（`isPrimary: false` の行が
 * 複数あってよいため、その組へは張れない）ので、**作るときのidを `main_<userId>` に決め打ち
 * して主キーで守る**（#264。統合のマイグレーション `20260903120000_merge_conversations` と
 * 同じ規則）。新しい利用者の初回表示では、ページの描画と `/api/notices/current` などが
 * 同時にここへ来る。どちらも `findFirst` が空で `create` へ進んでも、後から来た側は主キーの
 * 重複（`P2002`）で落ちるので、捕まえて引き直す。
 *
 * **`upsert` にしていない。** MySQLのPrismaは `upsert` をSELECT→INSERTで組み立てるので
 * 原子的ではなく、同じ競合で結局 `P2002` に当たる。**まず `findFirst` で引く形も変えない**——
 * #157より後に作られた利用者の連続セッションは `cuid()` のidで、`main_<userId>` を決め打ちで
 * 引くとその行を見つけられずに2本目を作ってしまう。
 *
 * それでも2本できていた場合（決め打ちの導入前に競合した行）に古い方を使い続けるよう、
 * `createdAt` の昇順で引く。
 *
 * **`React.cache` で包んである**（#226）。`(chat)/layout.tsx` とページが同じ描画の中で呼ぶため。
 * Route Handler・cron（`/api/chat`・`briefing.ts`・`notices.ts`）からの呼び出しには効かない
 * ——**その経路どうしの競合を止めているのは上の主キー**。
 */
export const primaryConversation = cache(async function primaryConversation(userId: string): Promise<{
  id: string;
  summary: string | null;
  summarizedCount: number;
}> {
  const find = () =>
    db.conversation.findFirst({
      where: { userId, isPrimary: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, summary: true, summarizedCount: true },
    });

  const existing = await find();
  if (existing) return existing;

  try {
    return await db.conversation.create({
      data: { id: primaryConversationId(userId), userId, isPrimary: true, title: PRIMARY_CONVERSATION_TITLE },
      select: { id: true, summary: true, summarizedCount: true },
    });
  } catch (error) {
    // 同時に来た別のリクエストが先に作った。作られた行をそのまま使う。
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const created = await find();
      if (created) return created;
    }
    throw error;
  }
});

/**
 * 連続セッションを作るときのid。統合のマイグレーションと、開発DBのシード
 * （`scripts/seed-ci-db.mjs`。プレーンJSでimportできないため同じ規則を二重に持つ）と揃える。
 */
export function primaryConversationId(userId: string): string {
  return `main_${userId}`;
}

/**
 * 秘書の側から積む「依頼（USER）＋返答（ASSISTANT）」の2通を、連続セッションの末尾へ足す
 * （#229。朝の見通し #79 と急ぎのお知らせ #115 が使う）。
 *
 * - **1通目をUSERにするのは、履歴の先頭をUSERにするため。** 秘書の返答だけを積むと、
 *   `buildConversationText()` が先頭のassistantを落とす場面で見通しがモデルから見えなくなる。
 *   依頼の文面は呼び出し側が渡す（`AUTO_REQUEST_PREFIX` から組み立てたもの。#280）
 * - **2通目は `at` の1秒後に置く。** 同じ時刻だと並び順が不定になり、返答が依頼より前に出る
 * - **`Conversation.updatedAt` も `at` へ進める。** 「最後に話したのはいつか」（#101のひとりごと）が
 *   この列を見ていて、発言を足しただけでは動かない。**声かけ（#278。`nudge.ts`）はここを通らない**
 *   ——あちらは進めない扱い（進めるとひとりごとの「昨日ぶりですね」が二度と出ない）
 *
 * `at` は**書き込む直前に取った時刻**を渡すこと（#261）。生成を待った後に、待つ前の時刻を
 * 渡すと、そのあいだに利用者が話しかけた発言より前へ割り込む。
 */
export async function appendSecretaryExchange(
  conversationId: string,
  request: string,
  reply: string,
  at: Date,
): Promise<void> {
  await db.$transaction([
    db.message.createMany({
      data: [
        { conversationId, role: "USER", content: request, createdAt: at },
        { conversationId, role: "ASSISTANT", content: reply, createdAt: new Date(at.getTime() + 1000) },
      ],
    }),
    db.conversation.update({ where: { id: conversationId }, data: { updatedAt: at } }),
  ]);
}

/** 左メニューに並べる1日ぶん。 */
export type DaySummary = {
  /** `2026-09-03`。URLの `/d/<date>` に入る値。 */
  date: string;
  /** `今日 9月3日（木）`。 */
  heading: string;
  /** `2026年9月`。同じ月が続く間は画面側で出さない。 */
  month: string;
  /** その日の発言数。 */
  count: number;
};

/**
 * 発言のある日を新しい順に並べる。
 *
 * **日付ごとの件数はSQLで畳む。** 全発言の `createdAt` を持ち帰ってJSで数える形にすると、
 * 相談の画面を開くたびに1本の連続セッション全部を読むことになる（一覧はチャットの
 * レイアウトが毎回引く。`src/app/(chat)/layout.tsx`）。
 *
 * `+ INTERVAL 9 HOUR` で日本時間へ寄せてから日付にする。`CONVERT_TZ()` を使わないのは、
 * MariaDBのタイムゾーンテーブルが読み込まれていない環境ではNULLを返すため。
 */
export async function listDays(conversationId: string, now: Date): Promise<DaySummary[]> {
  const rows = await db.$queryRaw<{ day: Date | string; count: bigint | number }[]>`
    SELECT DATE(\`createdAt\` + INTERVAL 9 HOUR) AS \`day\`, COUNT(*) AS \`count\`
    FROM \`Message\`
    WHERE \`conversationId\` = ${conversationId}
    GROUP BY \`day\`
    ORDER BY \`day\` DESC
    LIMIT ${DAY_LIST_LIMIT}
  `;

  const todayKey = jstDayKey(now);

  return rows.map((row) => {
    // ドライバによってDATEはDateにもstringにもなる。前者は日本時間で作った日付が
    // UTCの0時として返るため、`jstDayKey()` に通すと1日戻る。ここではISOの頭を切る。
    const date = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10);

    return {
      date,
      heading: dayHeading(date, todayKey),
      month: monthLabel(date),
      count: Number(row.count),
    };
  });
}

/**
 * 発言と、書き込みの道具を使った記録（#81）を時刻順に1本へ均す。
 *
 * 記録は `Message` とは別のテーブルにある（#46「保存するのは本文だけ」を崩さないため）ので、
 * 並べ直すのは読み出す側の仕事になる。`ToolCall.createdAt` には**呼んだ時点の時刻**が
 * 入っている（行を作るのは返答を保存した後）ため、同じ往復では
 * 利用者の発言 → 書き込みの記録 → 秘書の返答 の順に落ち着く。
 *
 * 時刻が並んだときは記録を先に置く。書き込みは必ず、その往復の返答より前に起きている。
 */
function mergeEntries(
  messages: {
    id: string;
    role: "USER" | "ASSISTANT";
    content: string;
    interrupted: boolean;
    proactive: boolean;
    createdAt: Date;
  }[],
  toolCalls: {
    id: string;
    serverLabel: string;
    toolName: string;
    input: string;
    output: string | null;
    failed: boolean;
    createdAt: Date;
  }[],
): ChatEntry[] {
  const rows: { at: number; tie: number; entry: ChatEntry }[] = [
    ...messages.map((message) => ({
      at: message.createdAt.getTime(),
      tie: 1,
      entry: {
        kind: "message" as const,
        id: message.id,
        role: message.role,
        content: message.content,
        interrupted: message.interrupted,
        proactive: message.proactive,
        day: jstDayKey(message.createdAt),
        time: jstTimeLabel(message.createdAt),
      },
    })),
    ...toolCalls.map((call) => ({
      at: call.createdAt.getTime(),
      tie: 0,
      entry: {
        kind: "tool" as const,
        id: call.id,
        server: call.serverLabel,
        tool: call.toolName,
        input: call.input,
        output: call.output,
        failed: call.failed,
        day: jstDayKey(call.createdAt),
      },
    })),
  ];

  return rows.sort((a, b) => a.at - b.at || a.tie - b.tie).map((row) => row.entry);
}

const MESSAGE_FIELDS = {
  id: true,
  role: true,
  content: true,
  interrupted: true,
  // 秘書の側から話しかけた発言（#278）。画面で印を出すために持ち帰る。
  proactive: true,
  createdAt: true,
} as const;

const TOOL_CALL_FIELDS = {
  id: true,
  serverLabel: true,
  toolName: true,
  input: true,
  output: true,
  failed: true,
  createdAt: true,
} as const;

/** ある期間の発言と記録を、時刻順に混ぜて返す。 */
async function entriesBetween(
  conversationId: string,
  from: Date | undefined,
  to: Date | undefined,
): Promise<ChatEntry[]> {
  const createdAt = { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
  const range = from || to ? { createdAt } : {};

  const [messages, toolCalls] = await Promise.all([
    db.message.findMany({
      where: { conversationId, ...range },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: MESSAGE_FIELDS,
    }),
    db.toolCall.findMany({
      where: { conversationId, ...range },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: TOOL_CALL_FIELDS,
    }),
  ]);

  return mergeEntries(messages, toolCalls);
}

/** その日1日ぶんの記録。 */
export function entriesForDay(conversationId: string, dayKey: string): Promise<ChatEntry[]> {
  return entriesBetween(conversationId, dayStart(dayKey), dayEnd(dayKey));
}

/**
 * 「今日」の画面に出す記録。今日ぶんと、少なすぎるときはその手前から少し。
 *
 * 手前から足すぶんも日付の区切りを持って出るので、どこからが今日かは画面で分かる。
 */
export async function entriesForToday(conversationId: string, now: Date): Promise<ChatEntry[]> {
  const from = dayStart(jstDayKey(now));
  const today = await entriesBetween(conversationId, from, undefined);

  if (today.length >= CARRY_OVER_MIN_ENTRIES) return today;

  // 引き継ぐ範囲は**発言だけで決める。** 書き込みの記録（`ToolCall`）まで同じ件数で
  // 遡ると、記録の少ない日が続いたときに**何日も前の書き込みだけが先頭に並ぶ**
  // （実測: 発言はきのうまでなのに、その手前に一昨日の `aide_zaim_payment` が3件出た）。
  const messages = await db.message.findMany({
    where: { conversationId, createdAt: { lt: from } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: CARRY_OVER_MIN_ENTRIES - today.length,
    select: MESSAGE_FIELDS,
  });

  if (messages.length === 0) return today;

  // いちばん古い発言と同じ時刻まで遡って、その間の書き込みだけを混ぜる。
  const carryFrom = messages[messages.length - 1].createdAt;
  const toolCalls = await db.toolCall.findMany({
    where: { conversationId, createdAt: { gte: carryFrom, lt: from } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: TOOL_CALL_FIELDS,
  });

  return [...mergeEntries(messages, toolCalls), ...today];
}
