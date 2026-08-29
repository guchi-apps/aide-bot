import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";

/**
 * 相談を削除する（#102）。
 *
 * 接続の画面（`/api/connections`）と違いフォームのPOSTにしない。一覧の行ごとにフォームを
 * 置くとスマホのドロワーが毎回閉じるうえ、押し間違いを防ぐ確認をはさむのに結局
 * クライアントJSが要るため。左メニュー（`ConversationRail`）から `fetch` で叩く。
 *
 * proxy.ts は `/api/*` をリダイレクトせず素通しするので、ログイン判定はここで行う。
 * 外部からのDELETEはセッションCookieの SameSite=Lax が弾く（Laxはトップレベルの
 * GETナビゲーションでしか送られない）。
 *
 * **一緒に消えるのは発言（`Message`）だけ。** 使用量（`ApiUsage`）と書き込みの記録
 * （`ToolCall`）はスキーマ側でSetNullにしてあり、相談との紐付けだけが外れて行は残る。
 * 消した相談ぶんの費用や、取り消せない書き込みをした事実まで消してしまわないため。
 */

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  // 他人の相談をIDだけで消せないよう、`userId` との組で絞ってから消す。
  // 該当が無ければ0件が返るので、存在しない場合と他人のものだった場合を同じ404で返せる。
  const { count } = await db.conversation.deleteMany({ where: { id, userId: user.id } });

  if (count === 0) {
    return NextResponse.json({ error: "その相談は見つかりませんでした。" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
