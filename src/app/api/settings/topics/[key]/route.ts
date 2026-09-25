import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { validateTopicCategoryInput } from "@/lib/topic-categories";
import { deleteTopicCategory, updateTopicCategory } from "@/lib/topic-category-store";

/**
 * 話題の種類1件の編集・オン/オフ・削除（#345）。`[key]` は `TopicCategory.key`。
 *
 * 必ず `userId` との組で引く（他人の種類は404）。削除しても仕入れ済みの記事は残る。
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ key: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const { key } = await params;

  // `enabled` だけの更新（チェックの切り替え）と、名前・説明の編集を1本で受ける。
  const hasFields = "label" in body || "scope" in body || "short" in body;
  if (!hasFields && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "更新する項目がありません。" }, { status: 400 });
  }

  let patch: { label?: string; short?: string; scope?: string; enabled?: boolean } = {};
  if (hasFields) {
    const input = validateTopicCategoryInput(body);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
    patch = { ...input.value };
  }
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;

  const result = await updateTopicCategory(user.id, key, patch);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ category: result.category });
}

export async function DELETE(_request: Request, { params }: Context) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const { key } = await params;
  if (!(await deleteTopicCategory(user.id, key))) {
    return NextResponse.json({ error: "その種類が見つかりません。" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
