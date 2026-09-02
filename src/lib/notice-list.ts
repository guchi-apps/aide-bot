import { NoticePriority, type Notice } from "@prisma/client";

import { db } from "@/lib/db";
import { safeNoticeUrl } from "@/lib/notice-url";
import { NOTICE_DISPLAY_TTL_MS } from "@/lib/notices";

/**
 * 積まれたお知らせを見るための取り出し（#114）。**サーバー専用。**
 *
 * #93 で受け皿を作ったが、画面から見えるのは秘書が選んだ1件の吹き出しだけだった。
 * 選ばれなかったものが控えていること・すでに出したこと・出ないまま期限が切れたことは、
 * どこにも出ていない。ここはその4つを取り出すだけで、**選定には一切関わらない**
 * （`shownAt` を書くのは `resolveNotice()` の1か所のまま。`src/lib/notices.ts`）。
 *
 * 取り出しの条件は `notices.ts` の `pendingNotices()` / `currentNotice()` と揃えてある。
 * ずらすと「画面には出ているのに候補に入らない」お知らせができ、原因が画面側かモデル側か
 * 切り分けられなくなる。
 */

/** 1つの欄に出す上限。積み上がったぶんを無制限に引かない。 */
const SECTION_LIMIT = 50;

/** 履歴に出す期間。これより古いものは、いまのところ辿る導線を持たない。 */
const HISTORY_DAYS = 7;

/** 画面へ渡す1件ぶん。Prismaの行をそのまま渡さず、出すものだけに絞る。 */
export type NoticeRow = {
  id: string;
  /** 積んだ側が付けた見出し。空なら本文の1行目で埋める（`title` は後から足した列）。 */
  title: string;
  body: string;
  source: string;
  kind: string;
  priority: NoticePriority;
  /** 積まれた時刻。 */
  createdAt: Date;
  /** これより前は出せない（未指定ならnull）。 */
  showAt: Date | null;
  expiresAt: Date | null;
  /** 吹き出しに出した時刻。未読ならnull。 */
  shownAt: Date | null;
  /** 秘書が実際に話した言葉。未読ならnull。 */
  spokenText: string | null;
  spokenUrgent: boolean;
  /** 押したときに開く先（#137）。無ければnull。`safeNoticeUrl()` を通した値だけを入れる。 */
  url: string | null;
};

export type NoticeBoard = {
  /** いま吹き出しに出しているもの。無ければnull。 */
  current: NoticeRow | null;
  /** まだ出しておらず、いま出せるもの。急ぎ→新しい順（候補の並びと同じ）。 */
  pending: NoticeRow[];
  /** まだ出しておらず、`showAt` がまだ来ていないもの。出せる時刻が早い順。 */
  waiting: NoticeRow[];
  /** 出したもの（新しい順）。いま出しているものは含まない。 */
  shown: NoticeRow[];
  /** 出さないまま期限が切れたもの（新しい順）。 */
  expired: NoticeRow[];
  /** 履歴に出している期間（日数）。画面の見出しに使う。 */
  historyDays: number;
};

function toRow(notice: Notice): NoticeRow {
  return {
    id: notice.id,
    // 積む側は `title` を省略できる（`ingestNotice()` が本文の1行目で埋める）が、
    // `title` を足す前に積まれた行は空文字のまま残っている。画面で埋め直す。
    title: notice.title || notice.body.split("\n", 1)[0].slice(0, 120),
    body: notice.body,
    source: notice.source,
    kind: notice.kind,
    priority: notice.priority,
    createdAt: notice.createdAt,
    showAt: notice.showAt,
    expiresAt: notice.expiresAt,
    shownAt: notice.shownAt,
    spokenText: notice.spokenText,
    spokenUrgent: notice.spokenUrgent,
    // 判定は取り出すたびに通す（#137）。列を足す前・判定を足す前に積まれた行が残っている。
    url: safeNoticeUrl(notice.url),
  };
}

/**
 * いま出している1件（#93の `currentNotice()` と同じ条件）。
 *
 * 出してから `NOTICE_DISPLAY_TTL_MS`（60分）を過ぎたものは吹き出しから引っ込んでいるので、
 * ここでも返さず履歴の方へ回す。
 */
async function currentRow(userId: string, now: Date): Promise<NoticeRow | null> {
  const shown = await db.notice.findFirst({
    where: {
      userId,
      shownAt: { gt: new Date(now.getTime() - NOTICE_DISPLAY_TTL_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { shownAt: "desc" },
  });

  if (!shown?.shownAt || !shown.spokenText) return null;
  return toRow(shown);
}

/** 画面に出す一式をまとめて取る。1画面ぶんなので、5本を並行して流す。 */
export async function noticeBoard(userId: string, now = new Date()): Promise<NoticeBoard> {
  const historySince = new Date(now.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

  const [current, pending, waiting, shown, expired] = await Promise.all([
    currentRow(userId, now),

    // 候補（`notices.ts` の `pendingNotices()` と同じ絞り込み・同じ並び）。
    db.notice.findMany({
      where: {
        userId,
        shownAt: null,
        OR: [{ showAt: null }, { showAt: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: SECTION_LIMIT,
    }),

    // まだ出せないもの。候補からは外れているが、積まれていることは見えた方がよい
    // （「積んだはずなのに何も出ない」を画面で切り分けられる）。
    db.notice.findMany({
      where: {
        userId,
        shownAt: null,
        showAt: { gt: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: { showAt: "asc" },
      take: SECTION_LIMIT,
    }),

    db.notice.findMany({
      where: { userId, shownAt: { gte: historySince } },
      orderBy: { shownAt: "desc" },
      take: SECTION_LIMIT,
    }),

    // 出さないまま期限が切れたもの。**読まれずに消えた**ことが分かる唯一の場所なので、
    // 出したものと混ぜずに別の欄へ置く。
    db.notice.findMany({
      where: {
        userId,
        shownAt: null,
        expiresAt: { lte: now, gte: historySince },
      },
      orderBy: { expiresAt: "desc" },
      take: SECTION_LIMIT,
    }),
  ]);

  return {
    current,
    pending: pending.map(toRow),
    waiting: waiting.map(toRow),
    // いま出している1件は上の欄に出しているので、履歴からは外す。
    shown: shown.filter((notice) => notice.id !== current?.id).map(toRow),
    expired: expired.map(toRow),
    historyDays: HISTORY_DAYS,
  };
}

/**
 * 未読の件数（左メニューのバッジ）。
 *
 * `chatter.ts` の `personalLines()` が数えているものと同じ条件——「いま出せる候補」だけを
 * 数え、`showAt` がまだ来ていないものは含めない。左メニューの数字と、秘書が
 * 「まだお伝えしていないお知らせがN件あります」と言う数を食い違わせない。
 */
export async function pendingNoticeCount(userId: string, now = new Date()): Promise<number> {
  return db.notice.count({
    where: {
      userId,
      shownAt: null,
      OR: [{ showAt: null }, { showAt: { lte: now } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
  });
}
