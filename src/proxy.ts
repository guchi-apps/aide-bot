import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export default async function proxy(request: NextRequest) {
  return updateSession(request);
}

// 静的アセットとPWAのmanifest・Service Workerは認証の対象外にする。ここを通すと未ログイン時に
// /login へのリダイレクトがHTMLで返り、MIMEタイプ違いで読み込みに失敗する。
//
// **`sw.js` を外すのは必須**（#79）。`.js` は除外パターンに入っていないため、public/sw.js を
// 置いただけでは `/sw.js` がここを通り、`navigator.serviceWorker.register()` が
// 「HTMLが返ってきた」として失敗する。加えて、通れば Service Worker の取得のたびに
// `supabase.auth.getUser()` の往復が入る。manifest.webmanifest とまったく同じ理由。
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|apple-icon|icon|.*\\.(?:svg|png|jpg|jpeg|webp)$).*)",
  ],
};
