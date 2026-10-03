import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";
import { PUSH_KINDS, parseDisabledKinds, serializeDisabledKinds } from "@/lib/push/kinds";

/**
 * 通知の種類ごとのオン・オフ（#488）。`{ "<種類>": true | false }` で、渡した種類だけを変える。
 *
 * 読むのはcronの経路なのでDBに持つ（Cookieは届かない）。知らない種類は400で断る。
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

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return NextResponse.json({ error: "変更する項目がありません。" }, { status: 400 });
  }

  const known = new Set<string>(PUSH_KINDS);
  for (const key of keys) {
    if (!known.has(key)) {
      return NextResponse.json({ error: "通知の種類の指定が正しくありません。" }, { status: 400 });
    }
    if (typeof body[key] !== "boolean") {
      return NextResponse.json({ error: `${key} は真偽値で指定してください。` }, { status: 400 });
    }
  }

  const row = await db.user.findUnique({ where: { id: user.id }, select: { pushDisabledKinds: true } });
  const disabled = parseDisabledKinds(row?.pushDisabledKinds);

  for (const kind of PUSH_KINDS) {
    if (kind in body) {
      if (body[kind]) disabled.delete(kind);
      else disabled.add(kind);
    }
  }

  const stored = serializeDisabledKinds(disabled);
  await db.user.update({ where: { id: user.id }, data: { pushDisabledKinds: stored } });

  return NextResponse.json({ ok: true, disabled: [...disabled] });
}
