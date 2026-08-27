import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { resolveNotice } from "@/lib/notices";

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
 */

export const dynamic = "force-dynamic";

/** 生成はモデルを1回叩く。既定のタイムアウトでは足りないことがある。 */
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notice: null });

  const notice = await resolveNotice(user.id);

  return NextResponse.json({ notice });
}
