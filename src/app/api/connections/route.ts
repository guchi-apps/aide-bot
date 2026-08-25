import { NextResponse, type NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import {
  deleteConnection,
  setConnectionEnabled,
  startConnection,
} from "@/lib/mcp/connections";
import { McpOAuthError } from "@/lib/mcp/oauth";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * 接続画面からの操作を受ける（#46）。
 *
 * ログアウトと同じくフォームのPOSTで受ける。クライアントJSに依存させないのは、
 * 「繋ぐ」が相手の認可画面への遷移そのもので、ブラウザに302を辿らせるのが素直なため。
 * 外部からのPOSTはセッションCookieの SameSite=Lax が弾く（Laxはトップレベルの
 * GETナビゲーションでしか送られない）。
 */

// 認可画面へ出るまでにディスカバリと登録で外部を2往復するため、静的に扱わせない。
export const dynamic = "force-dynamic";

function backToSettings(request: NextRequest, params?: Record<string, string>) {
  const url = new URL("/settings", getRequestOrigin(request));
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
  // フォームのPOSTに対するリダイレクトなので303。302だとPOSTのまま辿る実装がある。
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", getRequestOrigin(request)), 303);
  }

  const form = await request.formData();
  const action = String(form.get("action") ?? "");
  const id = String(form.get("id") ?? "");

  try {
    if (action === "connect") {
      const authorizeUrl = await startConnection({
        userId: user.id,
        url: String(form.get("url") ?? ""),
        label: String(form.get("label") ?? ""),
        origin: getRequestOrigin(request),
      });

      // 相手の認可画面へ送る。戻り先はコールバックのRoute Handler。
      return NextResponse.redirect(authorizeUrl, 303);
    }

    if (action === "enable" || action === "disable") {
      await setConnectionEnabled(user.id, id, action === "enable");
      return backToSettings(request);
    }

    if (action === "delete") {
      await deleteConnection(user.id, id);
      return backToSettings(request);
    }

    return backToSettings(request, { error: "操作の指定が正しくありません。" });
  } catch (error) {
    // 相手のサーバーが返した文言はそのまま出す。原因が分かるのはたいていその文面だけ。
    if (error instanceof McpOAuthError) {
      return backToSettings(request, { error: error.message });
    }

    console.error("[aide-bot] MCP接続の操作に失敗した", error);
    return backToSettings(request, {
      error: "接続の操作に失敗しました。少し待ってからもう一度お試しください。",
    });
  }
}
