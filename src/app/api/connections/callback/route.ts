import { NextResponse, type NextRequest } from "next/server";

import { completeConnection } from "@/lib/mcp/connections";
import { McpOAuthError } from "@/lib/mcp/oauth";
import { getRequestOrigin } from "@/lib/request-origin";

/**
 * 接続先の認可サーバーからの戻り先（#46）。
 *
 * ここはログイン判定を挟まない。相手の認可画面を経由して戻ってくる経路なので、
 * `state` が唯一の手掛かりになる。`state` はこちらが発行してDBへ保存した使い捨ての値で、
 * 当たった行の利用者以外は書き換えられない。
 */

export const dynamic = "force-dynamic";

function backToSettings(request: NextRequest, params: Record<string, string>) {
  const url = new URL("/settings", getRequestOrigin(request));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;

  // 認可画面で断られた場合。error_description のほうが具体的なのでそちらを優先する。
  const denied = query.get("error");
  if (denied) {
    return backToSettings(request, {
      error: query.get("error_description") ?? `接続を許可できませんでした（${denied}）。`,
    });
  }

  const code = query.get("code");
  const state = query.get("state");
  if (!code || !state) {
    return backToSettings(request, { error: "認可の応答が不完全でした。もう一度お試しください。" });
  }

  try {
    const { label } = await completeConnection({ state, code });
    return backToSettings(request, { connected: label });
  } catch (error) {
    if (error instanceof McpOAuthError) {
      return backToSettings(request, { error: error.message });
    }

    console.error("[aide-bot] MCP接続の完了に失敗した", error);
    return backToSettings(request, { error: "接続を完了できませんでした。" });
  }
}
