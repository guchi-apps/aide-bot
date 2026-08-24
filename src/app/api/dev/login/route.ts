import { NextResponse, type NextRequest } from "next/server";

import { CI_BYPASS_COOKIE_NAME, isDevLoginEnabled } from "@/lib/ci-auth-bypass";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * 開発用ログイン（#25）。バイパス用のCookieを立てて `/` へ送るだけ。
 *
 * 入るのは `pnpm db:seed:dev` が投入したダミーユーザー（`ci-screenshot-bot`）で、
 * 実ユーザーのデータには到達しない。
 *
 * **本番では常に404**（`isDevLoginEnabled` が `NODE_ENV=production` で偽になる）。
 * `/api/*` は proxy.ts → updateSession を素通りする設計のため、middleware側の
 * 追加設定は要らない。
 */
export async function POST(request: NextRequest) {
  if (!isDevLoginEnabled()) {
    return new NextResponse(null, { status: 404 });
  }

  const response = NextResponse.redirect(`${getRequestOrigin(request)}/`, {
    // POSTのリダイレクトをGETで追わせる（既定の307だとブラウザがPOSTのまま再送する）。
    status: 303,
  });

  response.cookies.set(CI_BYPASS_COOKIE_NAME, process.env.CI_LOGIN_BYPASS_SECRET!, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });

  return response;
}
