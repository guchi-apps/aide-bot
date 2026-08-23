import { NextResponse, type NextRequest } from "next/server";

import { isAllowedEmail } from "@/lib/allowed-users";
import { db } from "@/lib/db";
import { getRequestOrigin } from "@/lib/request-origin";
import { safeInternalPath } from "@/lib/safe-path";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getRequestOrigin(request);
  const code = searchParams.get("code");
  const next = safeInternalPath(searchParams.get("next"), "/");

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const { user } = data;

  // 初期リリースは許可されたユーザーのみ利用可能。
  // 許可外のアカウントはaide-bot側のユーザーを作らず、Supabaseのセッションも破棄する。
  if (!isAllowedEmail(user.email)) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_allowed`);
  }

  const metadata = user.user_metadata as Record<string, unknown>;
  const name = (metadata.full_name as string) ?? (metadata.name as string) ?? null;
  const image = (metadata.avatar_url as string) ?? null;

  await db.user.upsert({
    where: { supabaseUserId: user.id },
    create: { supabaseUserId: user.id, email: user.email ?? null, name, image },
    update: { email: user.email ?? null, name, image },
  });

  return NextResponse.redirect(`${origin}${next}`);
}
