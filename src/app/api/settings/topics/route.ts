import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { validateTopicCategoryInput } from "@/lib/topic-categories";
import { addTopicCategory, listTopicCategories } from "@/lib/topic-category-store";

/**
 * 話題（#144）として仕入れるニュースの種類の一覧と追加（#345）。
 *
 * DBに保存する。読むのが応答後のバックグラウンド（`refreshTopicsIfStale()`）で、Cookieを当てに
 * できないため。保存しただけでは仕入れ直さない——次に「話す」画面の問い合わせが来て、前回から
 * 間隔があいていれば新しい種類で仕入れる（触るたびに27秒の検索を走らせない）。
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  return NextResponse.json({ categories: await listTopicCategories(user.id) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const input = validateTopicCategoryInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const result = await addTopicCategory(user.id, input.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ category: result.category }, { status: 201 });
}
