import type { Notice, Prisma } from "@prisma/client";

/**
 * 「いま出せるお知らせ」の条件（#229）。**Prismaもプロセスの状態も持たない純粋なモジュール。**
 *
 * 「未読」「まだ出せない」「いま吹き出しに出ている」の判定は、秘書の選定（`notices.ts`）・
 * 一覧の画面（`notice-list.ts`）・左メニューの件数とひとりごとの件数（`notice-list.ts` の
 * `pendingNoticeCount()`・`chatter.ts`）が同じ条件で読む。CLAUDE.md「積まれたお知らせの一覧
 * （#114）」が「ずらすと『一覧には出ているのに候補に入らない』お知らせができる」と求めてきた
 * 揃え方を、手書きの複製ではなくここへ閉じることで守る。**条件を変えるときは、この
 * ファイルだけを直す。** `test/notice-conditions.test.ts` が、3つの条件が互いに重ならないことと、
 * JS側の判定（`isWithinShowWindow()`）が同じ結果になることを固定している。
 *
 * クライアントからもimportできるよう（表示の残り時間に `NOTICE_DISPLAY_TTL_MS` を使う）、
 * `@prisma/client` は型だけを読む。
 */

/**
 * 出した吹き出しを画面に残しておく時間（#93）。
 *
 * これを過ぎたものは「どうぞ、話しかけてください」へ戻す。**残し続けると、朝に選ばれた
 * お知らせが夜まで頭上に居座る**ことになり、いま知らせている内容だと誤解される。
 */
export const NOTICE_DISPLAY_TTL_MS = 60 * 60 * 1000;

/** 期限が無い、またはまだ来ていない。 */
function notExpired(now: Date): Prisma.NoticeWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

/**
 * まだ出していない、いま出せるお知らせ（秘書の選定の候補・一覧の「候補」・未読の件数）。
 *
 * `showAt` が来ていて（無ければ即座に）、期限を過ぎていないもの。
 */
export function pendingNoticeWhere(userId: string, now: Date): Prisma.NoticeWhereInput {
  return {
    userId,
    shownAt: null,
    OR: [{ showAt: null }, { showAt: { lte: now } }],
    AND: [notExpired(now)],
  };
}

/**
 * まだ出していないが、`showAt` がまだ来ていないお知らせ。
 *
 * 候補（`pendingNoticeWhere()`）からは外れるが、積まれていることは画面で見えた方がよい
 * （「積んだはずなのに何も出ない」を切り分けられる）。**件数には含めない。**
 */
export function waitingNoticeWhere(userId: string, now: Date): Prisma.NoticeWhereInput {
  return {
    userId,
    shownAt: null,
    showAt: { gt: now },
    ...notExpired(now),
  };
}

/**
 * いま吹き出しに出しておくお知らせ。出してから `NOTICE_DISPLAY_TTL_MS` を過ぎたもの・期限が
 * 切れたものは含めない。
 */
export function currentNoticeWhere(userId: string, now: Date): Prisma.NoticeWhereInput {
  return {
    userId,
    shownAt: { gt: new Date(now.getTime() - NOTICE_DISPLAY_TTL_MS) },
    ...notExpired(now),
  };
}

/**
 * 1件が「いま出せる時間帯」にあるか（`showAt` が来ていて、期限を過ぎていない）。
 *
 * `pendingNoticeWhere()` のうち `shownAt` を除いた部分と同じ条件を、すでに手元にある行に
 * 当てるためのもの。急ぎのPush（`notifyUrgentNotice()`）は積んだ直後の1件を判定するので、
 * もう一度DBへ引かない。
 */
export function isWithinShowWindow(notice: Pick<Notice, "showAt" | "expiresAt">, now: Date): boolean {
  if (notice.showAt && notice.showAt > now) return false;
  if (notice.expiresAt && notice.expiresAt <= now) return false;
  return true;
}
