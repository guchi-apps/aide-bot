import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { resolveChatter } from "@/lib/chatter";
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
 *
 * **待機中に回すひとりごと（#101）も同じ応答に載せる。** 取得口を分けると、問い合わせ1回ごとに
 * middlewareの `auth.getUser()` がもう1往復増える（`src/lib/supabase/middleware.ts`）。
 * ひとりごとはモデルを呼ばず、組み立て済みのものが `resolveChatter()` の中で使い回される。
 */

export const dynamic = "force-dynamic";

/** 生成はモデルを1回叩く。既定のタイムアウトでは足りないことがある。 */
export const maxDuration = 60;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ notice: null, chatter: [] });

  const [notice, chatter] = await Promise.all([resolveNotice(user.id), resolveChatter(user.id)]);

  return NextResponse.json({ notice, chatter });
}
