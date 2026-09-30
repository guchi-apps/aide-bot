import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";

/**
 * 話題の画面を見た時刻を記録する（#418）。`User.topicsSeenAt` より後に初めて取り込んだ記事が「NEW」になる。
 *
 * **「いま」ではなく、画面を描いた時刻を受け取る。** 描いた後に取り込まれた記事を、見ないまま既読に
 * しないため。未来の値は現在時刻へ丸め、保存済みより古い値では巻き戻さない（開いた端末が複数でも
 * 新しい方が残る）。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "本文が読めません。" }, { status: 400 });
  }
  const requested = typeof body.seenAt === "string" ? new Date(body.seenAt) : null;
  if (!requested || Number.isNaN(requested.getTime())) {
    return NextResponse.json({ error: "seenAtは日時で指定してください。" }, { status: 400 });
  }

  const now = new Date();
  const seenAt = requested.getTime() > now.getTime() ? now : requested;
  await db.user.updateMany({
    where: { id: user.id, OR: [{ topicsSeenAt: null }, { topicsSeenAt: { lt: seenAt } }] },
    data: { topicsSeenAt: seenAt },
  });
  return NextResponse.json({ ok: true });
}
