import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

// 静的アセットとPWAのmanifestは認証の対象外にする。ここを通すと未ログイン時に
// /login へのリダイレクトがHTMLで返り、MIMEタイプ違いで読み込みに失敗する。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
