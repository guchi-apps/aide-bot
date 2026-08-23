import { headers } from "next/headers";

import { SUPABASE_USER_ID_HEADER } from "@/lib/auth-header";
import { db } from "@/lib/db";

/**
 * ログイン中のユーザーを返す。
 *
 * Supabaseのセッション検証は proxy.ts が済ませ、結果をヘッダーで渡してくる。ここで
 * auth.getUser() を呼び直すと、1リクエストにつきSupabaseへの往復が2回入ってしまう。
 * proxy.ts のmatcherが外れているパス（静的アセット等）からは呼べないことに注意する。
 */
export async function getCurrentUser() {
  const supabaseUserId = (await headers()).get(SUPABASE_USER_ID_HEADER);
  if (!supabaseUserId) return null;

  return db.user.findUnique({ where: { supabaseUserId } });
}
