import { cookies, headers } from "next/headers";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth-header";
import {
  CI_BYPASS_COOKIE_NAME,
  CI_BYPASS_SUPABASE_USER_ID,
  isCiBypassRequest,
} from "@/lib/ci-auth-bypass";
import { db } from "@/lib/db";

/**
 * ログイン中のユーザーを返す。
 *
 * Supabaseのセッション検証は proxy.ts が済ませ、結果をヘッダーで渡してくる。ここで
 * auth.getUser() を呼び直すと、1リクエストにつきSupabaseへの往復が2回入ってしまう。
 * proxy.ts のmatcherが外れているパス（静的アセット等）からは呼べないことに注意する。
 */
export async function getCurrentUser() {
  // 開発／CI専用のログインバイパス（#25）。middlewareを通すだけではデータを引けないため、
  // ユーザー解決側にも同じ判定を必ず対で入れる（auth-dev-login skill）。
  // proxy.ts のmatcherが外れている経路から呼ばれても成立するよう、ヘッダーではなく
  // Cookieを直接見る。本番では isCiBypassRequest が常に偽。
  const cookieStore = await cookies();
  if (isCiBypassRequest(cookieStore.get(CI_BYPASS_COOKIE_NAME)?.value)) {
    // 見つからない場合（`pnpm db:seed:dev` 未実行）はnullを返し、呼び出し側が
    // 未ログインと同じ扱いで /login へ戻す。
    return db.user.findUnique({ where: { supabaseUserId: CI_BYPASS_SUPABASE_USER_ID } });
  }

  const supabaseUserId = (await headers()).get(SUPABASE_USER_ID_HEADER);
  if (!supabaseUserId) return null;

  return db.user.findUnique({ where: { supabaseUserId } });
}
