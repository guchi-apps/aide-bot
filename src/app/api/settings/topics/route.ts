import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { parseTopicCategories, serializeTopicCategories } from "@/lib/topic-categories";

/**
 * 話題（#144）として仕入れるニュースの種類を変更する。
 *
 * `briefing-time` と同じくDBに保存する。読むのが応答後のバックグラウンド（`refreshTopicsIfStale()`）
 * で、Cookieを当てにできないため。**すべて外した状態（空）も受け付ける**——それが「仕入れない」。
 *
 * 保存しただけでは仕入れ直さない。次に「話す」画面の問い合わせが来て、前回から間隔があいて
 * いれば新しい種類で仕入れる。チェックを触るたびに27秒の検索を走らせない。
 */

export const dynamic = "force-dynamic";

type Body = { categories?: unknown };

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  if (!Array.isArray(body.categories)) {
    return NextResponse.json({ error: "種類は配列で指定してください。" }, { status: 400 });
  }

  // 知らない値は落として保存する（利用者が書き換えられる値なので、そのまま入れない）。
  const value = serializeTopicCategories(body.categories);

  await db.user.update({ where: { id: user.id }, data: { topicCategories: value } });

  return NextResponse.json({ categories: parseTopicCategories(value) });
}
