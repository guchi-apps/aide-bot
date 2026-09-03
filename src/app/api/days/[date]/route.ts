import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { isDayKey } from "@/lib/day-key";
import { deleteDay, primaryConversation } from "@/lib/day-log";

/**
 * その日の記録を消す（#157。#102のスレッド削除を日単位へ移したもの）。
 *
 * 接続の画面（`/api/connections`）と違いフォームのPOSTにしない。一覧の行ごとにフォームを
 * 置くとスマホのドロワーが毎回閉じるうえ、押し間違いを防ぐ確認をはさむのに結局
 * クライアントJSが要るため。左メニュー（`ConversationRail`）から `fetch` で叩く。
 *
 * proxy.ts は `/api/*` をリダイレクトせず素通しするので、ログイン判定はここで行う。
 * 外部からのDELETEはセッションCookieの SameSite=Lax が弾く（Laxはトップレベルの
 * GETナビゲーションでしか送られない）。
 *
 * **他人の記録をURLだけで消せない。** 消す先は「いまログインしている利用者の連続セッション」
 * で、日付以外に宛先を指定する余地が無い——#102では相談のIDを受け取っていたので
 * `deleteMany` で `userId` ごと絞る必要があったが、その入口ごと無くなっている。
 *
 * **一緒に消えるのは発言（`Message`）だけ。** 使用量（`ApiUsage`）と書き込みの記録
 * （`ToolCall`）は残す（`deleteDay()` を参照）。
 */

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  if (!isDayKey(date)) {
    return NextResponse.json({ error: "日付の形が正しくありません。" }, { status: 400 });
  }

  const conversation = await primaryConversation(user.id);
  const count = await deleteDay(conversation, date);

  if (count === 0) {
    return NextResponse.json({ error: "その日の記録は見つかりませんでした。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: count });
}
