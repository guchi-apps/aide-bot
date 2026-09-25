import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { isChatModelId, mergeModelSettings, MODEL_USES, resolveModelSettings, type ChatModelId, type ModelUse } from "@/lib/chat-model";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";

/**
 * 用途ごとのモデルを変える（#349）。`{ "<用途>": "<モデルID>" }` の形で、渡した用途だけを更新する。
 *
 * 読むのはcronや返答後の後始末でもあるのでDBに持つ（Cookieは届かない）。
 */

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const changes: Partial<Record<ModelUse, ChatModelId>> = {};
  for (const [key, value] of Object.entries(body)) {
    const use = MODEL_USES.find((candidate) => candidate === key);
    if (!use) {
      return NextResponse.json({ error: `${key} は選べる用途ではありません。` }, { status: 400 });
    }
    if (!isChatModelId(value)) {
      return NextResponse.json({ error: `${key} のモデルが正しくありません。` }, { status: 400 });
    }
    changes[use] = value;
  }

  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "変更する用途を指定してください。" }, { status: 400 });
  }

  // 読み直してから重ねる（別の端末が同時に別の用途を変えても、片方を巻き戻さない範囲で十分——利用者は1人）。
  const current = await db.user.findUnique({ where: { id: user.id }, select: { modelSettings: true } });
  const next = mergeModelSettings(current?.modelSettings, changes);

  await db.user.update({
    where: { id: user.id },
    data: { modelSettings: Object.keys(next).length > 0 ? next : Prisma.DbNull },
  });

  return NextResponse.json({ ok: true, models: resolveModelSettings(next) });
}
