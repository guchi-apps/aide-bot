import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { db } from "@/lib/db";
import { encryptSession } from "@/lib/native-auth/cipher";
import { issueHandoff } from "@/lib/native-auth/handoff";
import { nativeLoginCodeUrl, nativeLoginErrorUrl } from "@/lib/native-auth/native-app";
import { handoffStore } from "@/lib/native-auth/stores";
import { isValidChallenge } from "@/lib/native-auth/tokens";
import { getRequestOrigin } from "@/lib/request-origin";
import { safeInternalPath } from "@/lib/safe-path";
import { signOutThisApp } from "@/lib/supabase/sign-out";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"), "/");

  // iOSアプリの認証シート（#441）。戻り先はアプリのスキームで、アプリへ返すのは一度限りの
  // 引き継ぎコードだけ。シートはエフェメラルでCookieを持たないため、セッションは
  // WKWebViewの /auth/native/consume が受け取る。
  const challenge = searchParams.get("challenge");
  const native = searchParams.get("native") === "1" && isValidChallenge(challenge);
  const failure = (error: "auth_failed" | "not_allowed") =>
    NextResponse.redirect(native ? nativeLoginErrorUrl(error) : `${origin}/login?error=${error}`);

  if (!code) {
    return failure("auth_failed");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return failure("auth_failed");
  }

  const { user } = data;

  // 初期リリースは許可されたユーザーのみ利用可能。
  // 許可外のアカウントはaide-bot側のユーザーを作らず、Supabaseのセッションも破棄する。
  if (!isAllowedEmail(user.email)) {
    await signOutThisApp(supabase);
    return failure("not_allowed");
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const name = (metadata.full_name as string) ?? (metadata.name as string) ?? null;
  const image = (metadata.avatar_url as string) ?? null;

  await db.user.upsert({
    where: { supabaseUserId: user.id },
    create: { supabaseUserId: user.id, email: user.email ?? null, name, image },
    update: { email: user.email ?? null, name, image },
  });

  if (native && challenge) {
    const session = data.session;
    if (!session) {
      return failure("auth_failed");
    }

    let handoffCode: string;
    try {
      handoffCode = await issueHandoff({
        store: handoffStore,
        challenge,
        sessionCipher: encryptSession(
          JSON.stringify({ accessToken: session.access_token, refreshToken: session.refresh_token }),
        ),
        next,
        now: new Date(),
      });
    } catch (e) {
      console.error("[aide-bot] iOSアプリへの引き継ぎコードを発行できなかった:", e instanceof Error ? e.message : e);
      return failure("auth_failed");
    }

    const nativeResponse = NextResponse.redirect(nativeLoginCodeUrl(handoffCode));
    // シートのCookieはシートの終了で捨てられるが、念のためここでも消す。サーバー側のセッションは
    // 失効させない（引き継ぎ先のWKWebViewが同じセッションを使うため）。
    for (const { name } of request.cookies.getAll()) {
      if (name.startsWith("sb-")) nativeResponse.cookies.delete(name);
    }
    return nativeResponse;
  }

  return NextResponse.redirect(`${origin}${next}`);
}
