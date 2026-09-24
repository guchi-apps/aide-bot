import { timingSafeEqual } from "node:crypto";

import { NextResponse, after } from "next/server";

import { runMorningBriefing } from "@/lib/briefing";
import { refreshHomeProfiles } from "@/lib/home-profile";
import { runProactiveSuggestions } from "@/lib/proactive";

/**
 * 朝の見通しを起動する（#79）。**cronから叩かれる、利用者のいない経路。**
 *
 * 新しい常駐プロセスを足さないため、スケジューリングは外（`guchi-apps/vps` の
 * `cron/crontab.txt`）に任せ、ここはワンショットで走るだけにしてある。
 *
 * ```
 * 0 7 * * * curl -fsS -X POST -H "Authorization: Bearer <token>" http://127.0.0.1:3103/api/briefing
 * ```
 *
 * ## 認証
 *
 * ログイン判定を挟まない。cronにはCookieもSupabaseのセッションも無い。代わりに共有
 * シークレットのBearerで守る（ログイン判定を挟まない前例として `/api/connections/callback`）。
 *
 * **`BRIEFING_TRIGGER_TOKEN` が未設定なら、この経路ごと閉じる。** 「未設定なら誰でも
 * 叩ける」にすると、設定漏れがそのまま公開エンドポイントになる（`ALLOWED_GOOGLE_EMAILS`
 * が未設定時に全員拒否なのと同じ考え方）。
 */

export const dynamic = "force-dynamic";

/**
 * 生成は道具を何度か叩くため、既定のタイムアウトでは足りないことがある。
 * cron側も `curl` が待てる範囲に収める。
 */
export const maxDuration = 300;

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual は長さが違うと例外を投げるため、先に長さを見る。
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.BRIEFING_TRIGGER_TOKEN ?? "";
  if (expected === "") return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;

  return safeEqual(header.slice("Bearer ".length), expected);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    // 未設定なのか値が違うのかを区別して返さない。外から設定状況を探れないようにする。
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  const outcomes = await runMorningBriefing();

  // 自宅の情報の取り込み（#167）。**朝の見通しとは独立**で、設定時刻の前でも走る
  // （見通しを送ったかどうかとは関係が無い）。前回から1日あいていなければDBを1回引くだけで
  // 戻るので、cronが30分ごとに叩いても取り込みは1日1回に収まる。
  const homeProfiles = await refreshHomeProfiles();

  // 先回りの提案（#325）。**応答を待たせない**——判定を通ればCodexが最大180秒かかるため、
  // 朝の見通しの結果を返した後（`after()`）で走らせる。判定の大半はDBを引くだけで戻る。
  // 朝の見通しとは抑制の単位（種類・上限）を分けてあり、その1日1本の枠を消費しない。
  after(async () => {
    try {
      const results = await runProactiveSuggestions();
      for (const { userId, status, delivered, detail } of results) {
        console.info(`[aide-bot] 先回りの提案: ${userId} ${status}（${delivered}台）${detail ? ` ${detail}` : ""}`);
      }
    } catch (error) {
      console.error("[aide-bot] 先回りの提案に失敗した", error);
    }
  });

  // cronのログ（メール）に流れる想定なので、届いたかどうかが一目で分かる形にする。
  // 本文そのものは返さない——ログに秘書の返答が丸ごと残るのは行き過ぎ。
  return NextResponse.json({
    ran: outcomes.length,
    outcomes: outcomes.map(({ userId, status, delivered, detail }) => ({
      userId,
      status,
      delivered,
      ...(detail ? { detail } : {}),
    })),
    homeProfiles,
  });
}
