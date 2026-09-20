import { NextResponse, after } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { resolveChatter } from "@/lib/chatter";
import { resolveNotice } from "@/lib/notices";
import { nudgeFromTopic, nudgesSince } from "@/lib/nudge";
import { refreshTopicsIfStale, topicsForBubble } from "@/lib/topics";

/**
 * いま吹き出しに出すお知らせを返す（#93）。「話す」画面から定期的に呼ばれる。
 *
 * proxy.ts は `/api/*` をリダイレクトせず素通しするので、ログイン判定はここで行う。
 *
 * **叩かれるたびにモデルを呼ぶわけではない。** 未読が0件のとき、および前の生成から
 * `NOTICE_INTERVAL_MS`（10分）経っていないときは、DBを引くだけで戻る。画面側が短い間隔で
 * 問い合わせられるのはそのため——急ぎが積まれた回だけ、その場で選び直しが走る。
 *
 * 未ログインでも200で `notice: null` を返す。画面が開いた直後に走る問い合わせで、
 * 401をエラーとして扱うと、ログインの切れ目に吹き出しへ関係のない文言が出る。
 *
 * **待機中に回すひとりごと（#101）も同じ応答に載せる。** 取得口を分けると、問い合わせ1回ごとに
 * middlewareの `auth.getUser()` がもう1往復増える（`src/lib/supabase/middleware.ts`）。
 * ひとりごとはモデルを呼ばず、組み立て済みのものが `resolveChatter()` の中で使い回される。
 *
 * **仕入れた話題（#144）も同じ応答に載せる。** こちらもDBを引くだけ。**ニュースの仕入れそのものは
 * 応答を返した後に走らせる**（`after()`）——1回27秒前後掛かるので応答の中で待つと吹き出しが
 * 止まって見え、この経路は「話す」画面から3分ごとに叩かれるので詰まったリクエストが積み上がる。
 * 走らせるかどうか（前回から1時間あいたか）は `refreshTopicsIfStale()` が決める。
 *
 * **秘書からの声かけ（#278）もここに相乗りさせている。** 取得口を増やさないのは上と同じ理由で、
 * 「書く」画面（`use-nudge.ts`）もこの口を `?since=<ISO>` 付きで叩く。`since` が無い回
 * （「話す」画面）では取り出しを省くが、**積むこと自体はどちらの画面から叩かれても行う**——
 * 書き込む先は1本の記録で、どちらの画面から開いても同じ並びが見える。
 */

export const dynamic = "force-dynamic";

/** 生成はモデルを1回叩く。既定のタイムアウトでは足りないことがある。 */
export const maxDuration = 60;

/**
 * 「これより後の声かけ」の基準時刻。
 *
 * 画面側が持っている最後の声かけの時刻で、**読めない値・遠すぎる過去は受け付けない**
 * ——1日以上眠っていたタブが戻ったときに、溜まった古い声かけを流れの末尾へまとめて
 * 並べてしまう（`nudgesSince()` は古い方から返す）。
 */
const SINCE_LIMIT_MS = 24 * 60 * 60 * 1000;

function parseSince(request: Request, now: Date): Date | null {
  const value = new URL(request.url).searchParams.get("since");
  if (!value) return null;

  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;

  const floor = now.getTime() - SINCE_LIMIT_MS;

  return new Date(Math.max(at, floor));
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notice: null, chatter: [], topics: [], nudges: [] });

  const now = new Date();
  const since = parseSince(request, now);

  const [notice, chatter, topics] = await Promise.all([
    resolveNotice(user.id),
    resolveChatter(user.id),
    topicsForBubble(user.id),
  ]);

  // 話題からの声かけ（#278）。DBを引くだけでモデルは呼ばないので、応答の中で待ってよい
  // （歯止めは `nudgeFromTopic()` 側で、30分に1回まで・会話の最中は積まない）。
  // お知らせからの声かけは `resolveNotice()` の中で積まれているので、ここでは触らない。
  await nudgeFromTopic(user.id, now);

  const nudges = since === null ? [] : await nudgesSince(user.id, since);

  // アプリを開いたとき（＝この問い合わせ）を仕入れの起点にする。応答は待たせない。
  after(() => refreshTopicsIfStale(user.id));

  return NextResponse.json({ notice, chatter, topics, nudges });
}
