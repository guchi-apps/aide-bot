import { db } from "@/lib/db";
import { formatJpy, startOfMonth, usageSummary } from "@/lib/usage";

/**
 * 待っている間、秘書が頭上の吹き出しで回す「ひとりごと」（#101）。**サーバー専用。**
 *
 * ホーム（「話す」画面）を開いたとき、吹き出しが「どうぞ、話しかけてください」で固定だと
 * ロボットが黙って立っているように見える。ここで短い一言を数件組み立てて画面へ渡し、
 * 画面側（`use-notice.ts`）が一定の間隔で入れ替える。
 *
 * ## 材料はすでに手元にあるものだけ。モデルは呼ばない
 *
 * お知らせ（#93）が「未読が0件ならAPIを1回も叩かない」で成立しているのと同じ理由で、
 * **ひとりごとは1件たりともモデルに書かせない。** 25秒ごとに入れ替わるものを生成させると、
 * 画面を開いているだけで費用が積み上がる。時刻・曜日・相談の記録・使用量・未読の件数という、
 * **すでにDBにあるものだけ**から組み立てる。
 *
 * 材料が定型なので、長く見ていれば同じ文が戻ってくる。それでも「常に何か話している」は
 * 成立するので、まずこの範囲で出す。
 *
 * ## 問い合わせは増やさない
 *
 * 画面からの取得口は増やさず、お知らせと同じ `/api/notices/current` の応答へ相乗りさせている。
 * `/api/*` は素通しの判定より前に必ず `auth.getUser()` を通る（`src/lib/supabase/middleware.ts`）
 * ため、**取得口を1つ増やすと問い合わせ1回ごとにSupabaseへの往復が1つ増える。**
 */

/**
 * 組み立て直さずに使い回す時間。
 *
 * 中身は「今月の相談は12件」のようにゆっくりしか変わらないものばかりなので、画面が3分ごとに
 * 問い合わせてくるたびにDBを引き直す必要が無い。**時間帯が変わった回は期限内でも組み立て直す**
 * ——「おはようございます」を昼まで出し続けないため。
 */
const CHATTER_TTL_MS = 30 * 60 * 1000;

type Cached = {
  at: number;
  /** 組み立てたときの時間帯。変わったら期限内でも作り直す。 */
  slot: string;
  lines: string[];
};

/**
 * 組み立て済みのひとりごと。**プロセス内にだけ持つ。**
 *
 * 失っても1回余分にDBを引くだけなので、DBへは持たない（#93の `lastRuns`・#48の
 * `pendingGenerations` と同じ置き方。PM2で1プロセスという前提も同じ）。
 */
const cache = new Map<string, Cached>();

/** 日本時間での時・曜日・日付。サーバーのタイムゾーンに頼らない（#79の `jstDateKey()` と同じ理由）。 */
function jstParts(now: Date): { hour: number; weekday: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    // 24時制の `hour` は深夜に "24" を返すことがある（Node 18以降で修正済みだが、
    // 環境差で踏むと「深夜だけ何も出ない」になるので丸めておく）。
    hour: Number(value("hour")) % 24,
    weekday: Math.max(0, weekdays.indexOf(value("weekday"))),
    date: `${value("year")}-${value("month")}-${value("day")}`,
  };
}

/** 時間帯の区切り。文言と、組み立て直しの判断の両方に使う。 */
function timeSlot(hour: number): "night" | "morning" | "noon" | "evening" | "late" {
  if (hour < 5) return "late";
  if (hour < 11) return "morning";
  if (hour < 15) return "noon";
  if (hour < 19) return "evening";
  if (hour < 23) return "night";
  return "late";
}

const SLOT_LINE: Record<ReturnType<typeof timeSlot>, string> = {
  morning: "おはようございます。今日はどんな一日にしましょうか",
  noon: "お昼どきですね。もう何か召し上がりましたか",
  evening: "夕方になりました。今日はいかがでしたか",
  night: "今日もお疲れさまでした。話し足りないことはありませんか",
  late: "もう遅い時間ですね。無理はなさらず",
};

const WEEKDAY_LINE = [
  "日曜日ですね。明日からに備えて、ゆっくりされてください",
  "月曜日ですね。今週の予定は決まっていますか",
  "火曜日ですね。今週はここからです",
  "水曜日ですね。ちょうど週の折り返しです",
  "木曜日ですね。あと少しで週末です",
  "金曜日ですね。週末の予定は決まっていますか",
  "土曜日ですね。ゆっくりできていますか",
];

/** 使い方のひとこと。毎回すべて出すと同じ話ばかりになるので、日替わりで1つだけ混ぜる。 */
const TIPS = [
  "設定から、わたしの声を変えられます",
  "「続けて話す」を入にしておくと、話し終えるたびにマイクが開きます",
  "声を出しづらいときは、下の「文字で送る」から文字で相談できます",
  "使った量と概算の費用は、左のメニューの「使用量」から見られます",
];

/** 経過した日数（日本時間の日付の差）。「3日前」を時刻の引き算で出すと、深夜のずれで1日狂う。 */
function daysBetween(from: Date, to: Date): number {
  const key = (date: Date) => {
    const { date: text } = jstParts(date);
    return Date.parse(`${text}T00:00:00Z`);
  };

  return Math.round((key(to) - key(from)) / 86_400_000);
}

/** 相談の記録から作る一言。まだ1件も無い人にも何か言えるようにしておく。 */
function conversationLine(lastTalkedAt: Date | null, now: Date): string {
  if (!lastTalkedAt) return "まだ一度もお話ししていませんね。下のマイクから始められます";

  const days = daysBetween(lastTalkedAt, now);
  if (days <= 0) return "さっきの続きでも、まったく別の話でも大丈夫です";
  if (days === 1) return "昨日ぶりですね。おかえりなさい";
  if (days >= 30) return "ずいぶんお久しぶりです。おかえりなさい";

  return `前にお話ししたのは${days}日前でした。おかえりなさい`;
}

/** DBを引いて作る一言。引けなかった項目は黙って落とす（吹き出しにエラーを出さない。#93）。 */
async function personalLines(userId: string, now: Date): Promise<string[]> {
  const monthStart = startOfMonth(now);

  const [lastConversation, monthlyCount, unreadCount, usage] = await Promise.all([
    db.conversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      select: { updatedAt: true },
    }),
    db.conversation.count({ where: { userId, createdAt: { gte: monthStart } } }),
    db.notice.count({
      where: {
        userId,
        shownAt: null,
        OR: [{ showAt: null }, { showAt: { lte: now } }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
    }),
    usageSummary({ userId, since: monthStart }),
  ]);

  const lines = [conversationLine(lastConversation?.updatedAt ?? null, now)];

  if (monthlyCount > 0) {
    lines.push(`今月の相談は${monthlyCount}件、費用は概算で${formatJpy(usage.costUsd)}です`);
  }

  if (unreadCount > 0) {
    lines.push(`まだお伝えしていないお知らせが${unreadCount}件あります`);
  }

  return lines;
}

/**
 * いま回せるひとりごと。**例外を外へ出さない。**
 *
 * 呼び出し元はお知らせを返すRoute Handlerで、ひとりごとが作れなかったせいでお知らせまで
 * 返らなくなる方が重い。DBが引けなかった回は、時刻と曜日だけの短い一覧に落とす。
 */
export async function resolveChatter(userId: string, now = new Date()): Promise<string[]> {
  const { hour, weekday, date } = jstParts(now);
  const slot = timeSlot(hour);

  const cached = cache.get(userId);
  if (cached && cached.slot === slot && now.getTime() - cached.at < CHATTER_TTL_MS) {
    return cached.lines;
  }

  // 既定の呼びかけ（「どうぞ、話しかけてください」）はここには入れない。**画面側が輪へ
  // 差し込む**——ひとりごとが1件も作れなかったときの表示でもあり、通信が失敗した回にも
  // 出る必要があるため（`use-notice.ts`）。
  const lines = [
    SLOT_LINE[slot],
    WEEKDAY_LINE[weekday],
    // 日替わりで1つだけ。日本時間の日付から引く（サーバーのタイムゾーンで引くと、
    // 深夜に日付が変わる時刻だけ別の一言に切り替わる）。
    TIPS[Number(date.slice(-2)) % TIPS.length],
  ];

  try {
    lines.push(...(await personalLines(userId, now)));
  } catch (error) {
    console.error("[aide-bot] ひとりごとの材料の取得に失敗した", error);
  }

  cache.set(userId, { at: now.getTime(), slot, lines });

  return lines;
}
