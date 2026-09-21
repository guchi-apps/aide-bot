import { NoticePriority, Prisma } from "@prisma/client";

import { primaryConversation } from "@/lib/day-log";
import { db } from "@/lib/db";
import { NOTICE_DISPLAY_TTL_MS } from "@/lib/notice-conditions";
import { safeNoticeUrl } from "@/lib/notice-url";
import { URGENT_NOTICE_KIND } from "@/lib/notices";
import { quietEnough, topicNudgeDue, withSourceLink } from "@/lib/nudge-choice";
import { TOPIC_LIFETIME_MS } from "@/lib/topics";

/**
 * 秘書の側から話しかける（声かけ。#278）。**サーバー専用**（Prismaを引き込む）。
 *
 * 秘書へ話しかけるのは常に利用者の側からで、仕入れたニュース（`Topic`。#144）も他のアプリが
 * 積んだ用件（`Notice`。#93）も、「話す」画面の吹き出しに黙って出るだけだった。**「書く」画面には
 * 一度も出ない。** ここでは同じ材料を**秘書の発言として1本の記録（#157）へ積み**、「書く」画面の
 * 流れに出す。押せば続きを話せる相手が最初から画面の中にいる形になる。
 *
 * ## モデルは1回も呼ばない
 *
 * 文面は**すでに生成済みのもの**を使う——話題は仕入れたときに書かせた一言（`Topic.lead`）、
 * お知らせは選定（#132）で書かせた一言（`Notice.spokenText`）。#93・#101の「黙っている間の
 * 費用は0円」はそのまま守られる。**声かけのために言い直させないこと**——そうした瞬間に、
 * 画面を開いている間ずっと費用が積み上がる造りへ変わる。
 *
 * ## 積むのはASSISTANTの1通だけ
 *
 * 朝の見通し（#79）と急ぎのお知らせ（#115）は「USER（依頼）＋ASSISTANT（本文）」の2通を積むが、
 * 声かけは1通だけにしてある。**依頼に当たる発言が実在しない**ので、画面に「（自動）〜を教えて。」
 * という偽の依頼を出したくない（#280はその依頼文を画面から隠す側の手当て）。
 * `buildConversationText()`（`src/app/api/chat/route.ts`）は履歴の先頭に来たassistantを落とすので、
 * **落ちるのはcompact（#157）の直後に声かけが履歴の先頭へ来た回だけ**——その回はモデルから
 * 見えないが、画面と記録には残る。
 *
 * ## 会話の最中には積まない
 *
 * 積むのは `/api/notices/current`（「話す」画面からも3分ごとに叩かれる）の中で、**走っている
 * 往復のことは知らない。** 利用者の発言は往復の頭で保存され、秘書の返答は生成が終わってから
 * 保存されるので、何も見ずに積むと**その2つのあいだへ割り込む**（画面の並びも、次の往復で
 * モデルへ渡す履歴も、実際のやり取りと食い違う）。最新の発言から `NUDGE_QUIET_MS`（3分）を
 * 空ける歯止めがそれを塞いでいる——Codexの1往復は最大120秒（#128）なので、生成中は必ず弾かれる。
 *
 * **そのため「吹き出しに出した回」と「記録へ積む回」は別の時点になる。** お知らせは選定
 * （`resolveNotice()`）の側では積まず、**あとから「まだ積んでいない、出したお知らせ」を拾う**形に
 * してある（`nudgeFromNotice()`）。選定の中で積む形にすると、会話の最中に選ばれた用件は
 * `shownAt` だけ付いて記録に残らず、二度と積み直せない。
 */

/** 画面へ渡す声かけ1件。`Message` の行そのままで、role は常にASSISTANT。 */
export type Nudge = {
  id: string;
  content: string;
  /** 積んだ時刻（ISO）。画面側が「これより後の声かけ」を取り直すために持つ。 */
  createdAt: string;
};

/** 1回の問い合わせで返す声かけの上限。溜まっていても一度に流し込まない。 */
const NUDGE_FETCH_LIMIT = 5;

/**
 * 出したお知らせを、声かけとして積み直せる期間。
 *
 * 吹き出しに出ている時間（`NOTICE_DISPLAY_TTL_MS`。1時間）と同じにしてある。会話の最中に
 * 選ばれた用件は3分ほど遅れて積まれるが、**1時間も経ったものを蒸し返さない**——そのときには
 * 吹き出しからも消えており、いま知らせている内容だと誤解される（#93と同じ理由）。
 */
const NOTICE_NUDGE_WINDOW_MS = NOTICE_DISPLAY_TTL_MS;

/** 1回に見る「出したお知らせ」の数。積むのは常に1件だけ（古い方から）。 */
const NOTICE_NUDGE_CANDIDATES = 6;

/**
 * 直近に声かけを積んだ時刻。**プロセス内にだけ持つ**（#93の `lastRuns`・#144の `attempts` と
 * 同じ置き方。PM2で1プロセスという前提も同じ）。
 *
 * 失っても1回余分に話しかけるだけなので列にはしない。**お知らせからの声かけもここへ記録する**
 * ——用件の直後に雑談の話題が続くと、2つ並べて読まれて用件の方が薄まる。
 */
const lastNudges = new Map<string, number>();

function toNudge(row: { id: string; content: string; createdAt: Date }): Nudge {
  return { id: row.id, content: row.content, createdAt: row.createdAt.toISOString() };
}

/**
 * 声かけの発言のid。**材料（お知らせ・話題）ごとに決め打ちする**（#264の `main_<userId>` と
 * 同じ手）。
 *
 * 狙いは2つ。**同じ材料で2通積まれるのを主キーで止める**こと——2つの画面（iPhoneの「話す」と
 * PCの「書く」）の問い合わせが重なると、同じ材料で同時に積みうる（開発サーバーのStrict Modeの
 * 二重実行で実測）。もう1つは**「もう積んだか」をidの有無で引けること**——お知らせは選定とは
 * 別の時点で積むので、積んだ印を別の列に持たずに済む。
 */
function nudgeMessageId(kind: "notice" | "topic", materialId: string): string {
  return `nudge_${kind === "notice" ? "n" : "t"}_${materialId}`;
}

/** 主キーの重複（＝同じ材料で誰かが先に積んだ）か。 */
function isDuplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * 声かけを1件、連続セッションへ積む。先に積まれていれば `null`。
 *
 * **`Conversation.updatedAt` は動かさない。** あの列が指すのは「最後に話したのはいつか」で、
 * 待機中のひとりごと（#101。`chatter.ts` の `conversationLine()`）が「昨日ぶりですね」
 * 「前にお話ししたのは3日前でした」を出すのに使っている。**秘書が話しかけた回で進めると、
 * その文言が二度と出ない**（毎日どれかの声かけが積まれるため）。3分の間合いも最新の
 * `Message.createdAt` で測っているので、この列は要らない。
 */
async function appendNudge(params: {
  conversationId: string;
  id: string;
  content: string;
  now: Date;
}): Promise<Nudge | null> {
  try {
    const message = await db.message.create({
      data: {
        id: params.id,
        conversationId: params.conversationId,
        role: "ASSISTANT",
        content: params.content,
        proactive: true,
        createdAt: params.now,
      },
      select: { id: true, content: true, createdAt: true },
    });

    return toNudge(message);
  } catch (error) {
    if (isDuplicate(error)) return null;
    throw error;
  }
}

/** 最新の発言の時刻。1件も無ければnull。 */
async function lastMessageAt(conversationId: string): Promise<number | null> {
  const last = await db.message.findFirst({
    where: { conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });

  return last?.createdAt.getTime() ?? null;
}

/**
 * 出したお知らせのうち、まだ声かけとして積んでいないものを1件積む。
 *
 * **選定（`resolveNotice()`）の中では積まない。** あちらは会話の最中でも吹き出しのために走る
 * ので、その場で積むと往復の途中へ割り込む。ここは「`spokenText` が入っていて、`nudge_n_<id>`
 * の発言がまだ無いお知らせ」を拾うだけなので、**会話が途切れてから積み直せる。**
 *
 * - **急ぎ（`URGENT`）でその場のPushを送ったぶんは積まない。** #115が同じ用件をUSER＋ASSISTANTの
 *   2通で記録へ積んでいるため、重ねると同じ話が2度並ぶ
 * - **古い方から1件ずつ。** 溜まっていても一度に流し込まない（記録の並びも読む順のままになる）
 * - **例外を外へ出さない。** 呼び出し元は吹き出しを返すRoute Handlerで、声かけが積めなかった
 *   せいでお知らせまで返らなくなる方が重い
 */
export async function nudgeFromNotice(userId: string, now = new Date()): Promise<Nudge | null> {
  try {
    const conversation = await primaryConversation(userId);
    if (!quietEnough(now.getTime(), await lastMessageAt(conversation.id))) return null;

    const shown = await db.notice.findMany({
      where: {
        userId,
        spokenText: { not: null },
        shownAt: { gt: new Date(now.getTime() - NOTICE_NUDGE_WINDOW_MS) },
      },
      // 出した順に積む。新しい方から積むと、記録の並びが吹き出しに出た順と逆になる。
      orderBy: [{ shownAt: "asc" }, { id: "asc" }],
      take: NOTICE_NUDGE_CANDIDATES,
      select: { id: true, title: true, url: true, spokenText: true, priority: true },
    });
    if (shown.length === 0) return null;

    const appended = await db.message.findMany({
      where: { id: { in: shown.map((notice) => nudgeMessageId("notice", notice.id)) } },
      select: { id: true },
    });
    const done = new Set(appended.map((message) => message.id));

    // その場でPushした急ぎ（#115）は、すでに記録へ2通で積まれている。
    const urgent = shown.filter((notice) => notice.priority === NoticePriority.URGENT);
    const pushed = new Set<string>();
    if (urgent.length > 0) {
      const logs = await db.notificationLog.findMany({
        where: { userId, kind: URGENT_NOTICE_KIND, dedupeKey: { in: urgent.map((notice) => notice.id) } },
        select: { dedupeKey: true },
      });
      for (const log of logs) pushed.add(log.dedupeKey);
    }

    const target = shown.find(
      (notice) => !done.has(nudgeMessageId("notice", notice.id)) && !pushed.has(notice.id),
    );
    if (!target || target.spokenText === null) return null;

    const nudge = await appendNudge({
      conversationId: conversation.id,
      id: nudgeMessageId("notice", target.id),
      content: withSourceLink(target.spokenText, target.title, safeNoticeUrl(target.url)),
      now,
    });

    if (nudge) lastNudges.set(userId, now.getTime());

    return nudge;
  } catch (error) {
    console.error("[aide-bot] お知らせからの声かけに失敗した", error);
    return null;
  }
}

/** 出典のリンクに添える見出し。媒体名が取れていればそれも添える。 */
function topicLabel(topic: { title: string; sourceName: string }): string {
  return topic.sourceName === "" ? topic.title : `${topic.title}（${topic.sourceName}）`;
}

/**
 * まだ振っていない話題（#144）から声かけを1件作る。**必ずすぐ戻り、失敗を投げない。**
 *
 * 走らせない条件は軽いものから見る。**同期の判定を通ったら、DBを待つ前に「積んだ」印を
 * 立てる**（#263の `running` と同じ理由——2つのタブの問い合わせが重なると、同じ回に2件積む）。
 * 見送った回は前回の値へ戻し、次の問い合わせでまた判定させる。
 *
 * 1. 前回の声かけから `NUDGE_INTERVAL_MS`（30分）あいていない
 * 2. 最後の発言から `NUDGE_QUIET_MS`（3分）経っていない＝話している最中（生成中を含む）
 * 3. まだ振っていない、期間内（24時間）の話題が無い
 *
 * **失敗した回は印を戻さない。** 戻すと、DBが不調なあいだ3分ごとの問い合わせのたびに
 * 同じところで落ちる。次に試すのは30分後でよい（#249の `failedAt` と同じ考え方）。
 */
export async function nudgeFromTopic(userId: string, now = new Date()): Promise<Nudge | null> {
  const previous = lastNudges.get(userId) ?? null;
  if (!topicNudgeDue(now.getTime(), previous)) return null;

  lastNudges.set(userId, now.getTime());
  const release = () => {
    if (previous === null) lastNudges.delete(userId);
    else lastNudges.set(userId, previous);
  };

  try {
    const conversation = await primaryConversation(userId);

    if (!quietEnough(now.getTime(), await lastMessageAt(conversation.id))) {
      release();
      return null;
    }

    const topic = await db.topic.findFirst({
      where: { userId, spokenAt: null, fetchedAt: { gt: new Date(now.getTime() - TOPIC_LIFETIME_MS) } },
      // 新しい順。同じ回に仕入れたものは `fetchedAt` が同じなので、第2のキーで並びを固定する。
      orderBy: [{ fetchedAt: "desc" }, { id: "asc" }],
      select: { id: true, lead: true, title: true, sourceName: true, url: true },
    });
    if (!topic) {
      release();
      return null;
    }

    const nudge = await appendNudge({
      conversationId: conversation.id,
      id: nudgeMessageId("topic", topic.id),
      content: withSourceLink(topic.lead, topicLabel(topic), safeNoticeUrl(topic.url)),
      now,
    });

    // 振った印。これが入っている話題はもう選ばれない（吹き出しの候補からは外さない）。
    // **声かけを積めた回だけ付ける**——先に付けると、重複で積まなかった回にも印だけが残る。
    if (nudge) await db.topic.update({ where: { id: topic.id }, data: { spokenAt: now } });
    else release();

    return nudge;
  } catch (error) {
    console.error("[aide-bot] 話題からの声かけに失敗した", error);
    return null;
  }
}

/**
 * ある時刻より後に積まれた声かけ。「書く」画面が自分の知らないぶんを取るために呼ぶ。
 *
 * **誰が積んだかを問わない**ので、この問い合わせの中で積まれたぶん（お知らせ・話題）も、
 * 別のタブで積まれたぶんも同じように拾える。
 *
 * **例外を外へ出さない。** 呼び出し元は吹き出しを返すRoute Handlerで、声かけが引けなかった
 * せいでお知らせまで返らなくなる方が重い（`resolveChatter()`・`topicsForBubble()` と同じ方針）。
 */
export async function nudgesSince(userId: string, since: Date): Promise<Nudge[]> {
  try {
    const conversation = await primaryConversation(userId);

    const rows = await db.message.findMany({
      where: { conversationId: conversation.id, proactive: true, createdAt: { gt: since } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: NUDGE_FETCH_LIMIT,
      select: { id: true, content: true, createdAt: true },
    });

    return rows.map(toNudge);
  } catch (error) {
    console.error("[aide-bot] 声かけの取得に失敗した", error);
    return [];
  }
}
