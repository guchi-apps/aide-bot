import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { validateTopicCategoryInput } from "@/lib/topic-categories";
import { previewTopics } from "@/lib/topics";

/**
 * 種類の説明文でどんな記事が集まるかを試す（#345）。**何も保存しない。**
 *
 * ChatGPTのサブスク枠を1回ぶん使い、20〜30秒かかる。連打は `previewTopics()` が断る（1分に1回）。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const input = validateTopicCategoryInput(body);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });

  const result = await previewTopics(user.id, input.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ articles: result.articles });
}
