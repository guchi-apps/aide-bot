import { NextResponse, type NextRequest } from "next/server";

import { getRequestOrigin } from "@/lib/request-origin";
import { createClient } from "@/lib/supabase/server";

/**
 * ログアウトする。
 *
 * ログイン（/auth/signin）と同じく、クライアントJSのハイドレーション前でも押せる必要があるため
 * フォームのPOSTで受ける。GETにしないのは、ブラウザやリンクの先読みで意図せず
 * ログアウトさせられることを避けるため。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[aide-bot] ログアウトに失敗:", error.message);
  }

  // POSTのリダイレクトは303で返す。既定の307のままだとリダイレクト先へもPOSTされてしまう。
  return NextResponse.redirect(new URL("/login", getRequestOrigin(request)), 303);
}
