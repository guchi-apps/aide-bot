import { Prisma } from "@prisma/client";

import { primaryConversation } from "@/lib/day-log";
import { db } from "@/lib/db";
import { safeNoticeUrl } from "@/lib/notice-url";
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
 * という偽の依頼を出したくない。`buildConversationText()`（`src/app/api/chat/route.ts`）は履歴の
 * 先頭に来たassistantを落とすので、**落ちるのはcompact（#157）の直後に声かけが履歴の先頭へ来た
 * 回だけ**——その回はモデルから見えないが、画面と記録には残る。
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
 * **同じ材料で2通積まれるのを主キーで止めるため。** 選定（#132）はモデルを数秒待つあいだ錠を
 * 置かないので、**同時に届いた2本の問い合わせが同じお知らせを選び、声かけを2通積む**
 * （開発サーバーのStrict Modeの二重実行で実測。2つのタブ・2つの端末でも起こりうる）。
 * 一意制約を足すより、作るときのidを決めてしまう方が既存の形に合う。
 */
function nudgeMessageId(kind: "notice" | "topic", materialId: string): string {
  return `nudge_${kind === "notice" ? "n" : "t"}_${materialId}`;
}

/** 主キーの重複（＝同じ材料で誰かが先に積んだ）か。 */
function isDuplicate(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * お知らせから声かけを1件、連続セッションへ積む。先に積まれていれば `null`。
 *
 * **`Conversation.updatedAt` を同じトランザクションで更新する。** 発言を足しても親の列は
 * 動かず、「最後に話したのはいつか」（#101のひとりごと）がそこを読んでいる。
 *
 * 歯止め（間隔・会話の最中か）はここでは見ない。**用件は待てないため**——話題からの声かけ
 * だけが `nudgeFromTopic()` の側で待つ。ただし**積んだ時刻は記録する**ので、用件の直後に
 * 雑談の話題が続くことはない。
 */
export async function appendNoticeNudge(params: {
  userId: string;
  noticeId: string;
  content: string;
  now?: Date;
}): Promise<Nudge | null> {
  const { userId, noticeId, content } = params;
  const now = params.now ?? new Date();
  const conversation = await primaryConversation(userId);

  try {
    const [message] = await db.$transaction([
      db.message.create({
        data: {
          id: nudgeMessageId("notice", noticeId),
          conversationId: conversation.id,
          role: "ASSISTANT",
          content,
          proactive: true,
          createdAt: now,
        },
        select: { id: true, content: true, createdAt: true },
      }),
      db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } }),
    ]);

    lastNudges.set(userId, now.getTime());

    return toNudge(message);
  } catch (error) {
    if (isDuplicate(error)) return null;
    throw error;
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

    const last = await db.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { createdAt: true },
    });
    if (!quietEnough(now.getTime(), last?.createdAt.getTime() ?? null)) {
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

    const content = withSourceLink(topic.lead, topicLabel(topic), safeNoticeUrl(topic.url));

    const [message] = await db.$transaction([
      db.message.create({
        data: {
          id: nudgeMessageId("topic", topic.id),
          conversationId: conversation.id,
          role: "ASSISTANT",
          content,
          proactive: true,
          createdAt: now,
        },
        select: { id: true, content: true, createdAt: true },
      }),
      // 振った印。これが入っている話題はもう選ばれない（吹き出しの候補からは外さない）。
      db.topic.update({ where: { id: topic.id }, data: { spokenAt: now } }),
      db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: now } }),
    ]);

    return toNudge(message);
  } catch (error) {
    // 同じ話題で先に積まれていた（印を立てる前に別のプロセスが通った）。失敗ではない。
    if (isDuplicate(error)) return null;

    console.error("[aide-bot] 話題からの声かけに失敗した", error);
    return null;
  }
}

/**
 * ある時刻より後に積まれた声かけ。「書く」画面が自分の知らないぶんを取るために呼ぶ。
 *
 * **誰が積んだかを問わない**ので、この問い合わせの中で積まれたぶん（お知らせ・話題）も、
 * 別のタブや朝の見通しの経路（#79）で積まれたぶんも同じように拾える。
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
