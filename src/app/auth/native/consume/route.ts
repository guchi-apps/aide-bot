import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { readJsonObject } from "@/lib/json-body";
import { decryptSession } from "@/lib/native-auth/cipher";
import { consumeHandoff } from "@/lib/native-auth/handoff";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidVerifier } from "@/lib/native-auth/tokens";
import { safeInternalPath } from "@/lib/safe-path";
import { createClient } from "@/lib/supabase/server";
import { signOutThisApp } from "@/lib/supabase/sign-out";

/**
 * 引き継ぎコードを消費して、WKWebViewへ通常のSupabase SSR Cookieを渡す（#441）。
 *
 * WKWebViewの中から `fetch`（同一オリジン・POST）で呼ぶ。コードとcode_verifierはURLではなく
 * 本文で受けるため、アクセスログに残らない。失敗の理由は区別せず同じ応答にする。
 */
export async function POST(request: NextRequest) {
  const body = await readJsonObject(request);
  const code = typeof body?.code === "string" ? body.code : "";
  const verifier = body?.verifier;

  const rejected = () => NextResponse.json({ error: "invalid_handoff" }, { status: 400 });

  if (!code || !isValidVerifier(verifier)) return rejected();

  const handoff = await consumeHandoff({ store: handoffStore, code, verifier, now: new Date() });
  if (!handoff) return rejected();

  let tokens: { accessToken: string; refreshToken: string };
  try {
    tokens = JSON.parse(decryptSession(handoff.sessionCipher));
  } catch {
    return rejected();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (error || !data.user) return rejected();

  // 発行後に許可リストから外れた場合に備え、ここでも確かめる（#246）。
  if (!isAllowedEmail(data.user.email)) {
    await signOutThisApp(supabase);
    return NextResponse.json({ error: "not_allowed" }, { status: 403 });
  }

  return NextResponse.json({ next: safeInternalPath(handoff.next, "/") });
}
