import { cookies, headers } from "next/headers";
import { cache } from "react";

import { isAllowedEmail } from "@/lib/allowed-users";
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
 *
 * **`React.cache` で包み、1回の描画の中では1度しか引かない**（#226）。`(chat)/layout.tsx` と
 * 各ページがそれぞれ呼ぶため、包まないと画面を開くたびに同じ行を2回引く。効くのはServer
 * Componentsの描画中だけで、Route Handlerからの呼び出しはこれまでどおり毎回引く。
 */
export const getCurrentUser = cache(async function getCurrentUser() {
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

  const user = await db.user.findUnique({ where: { supabaseUserId } });

  // 許可リストの判定は /auth/callback（ログインの瞬間）だけでなく、ここでも毎回通す（#246）。
  // Supabaseのセッションはリフレッシュトークンで更新され続け、`User` 行も残るので、
  // ALLOWED_GOOGLE_EMAILS から外しただけではログイン済みのアカウントが使い続けられる。
  // DB行は引き終えているので往復は増えない。開発用ログインの分岐は上で先に返しており対象外。
  if (!user || !isAllowedEmail(user.email)) return null;

  return user;
});
