import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { generateWakeToken, hashWakeToken } from "@/lib/wake-token";

/**
 * 起床の合図（#233）を受け付けるトークンの発行（POST）と削除（DELETE）。
 *
 * **トークンの本体を返すのは発行したこの応答だけ。** DBにはハッシュしか残らない。作り直すと
 * 前のトークンはその場で使えなくなる（1利用者1本）。
 */

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const token = generateWakeToken();

  await db.user.update({
    where: { id: user.id },
    // 作り直したら「最後の合図」も消す。前のトークンで届いた時刻を、新しいトークンが
    // 効いている証拠として読ませない。
    data: { wakeTokenHash: hashWakeToken(token), wakeTokenCreatedAt: new Date(), wakeTokenUsedAt: null },
  });

  return NextResponse.json({ token });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  await db.user.update({
    where: { id: user.id },
    data: { wakeTokenHash: null, wakeTokenCreatedAt: null, wakeTokenUsedAt: null },
  });

  return NextResponse.json({ ok: true });
}
