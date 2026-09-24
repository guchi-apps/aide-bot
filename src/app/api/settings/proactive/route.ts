import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";
import { PROACTIVE_FREQUENCIES, type ProactiveFrequency } from "@/lib/proactive-labels";

/**
 * 先回りの提案（#325）の設定を変える。渡した項目だけを更新する。
 *
 * 読むのはcronの経路（`src/lib/proactive.ts`）なのでDBに持つ（Cookieは届かない）。
 * 通知そのもののオン・オフ（購読）は別（`/api/push`）で、ここを切っても会話からの提案（#324）は使える。
 */

export const dynamic = "force-dynamic";

function isHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const data: {
    proactiveWeekend?: boolean;
    proactiveFreeTime?: boolean;
    proactiveOngoing?: boolean;
    proactiveAvoidWork?: boolean;
    proactiveQuietStart?: number;
    proactiveQuietEnd?: number;
    proactiveFrequency?: ProactiveFrequency;
  } = {};

  for (const [field, column] of [
    ["weekend", "proactiveWeekend"],
    ["freeTime", "proactiveFreeTime"],
    ["ongoing", "proactiveOngoing"],
    ["avoidWork", "proactiveAvoidWork"],
  ] as const) {
    if (field in body) {
      if (typeof body[field] !== "boolean") {
        return NextResponse.json({ error: `${field} は真偽値で指定してください。` }, { status: 400 });
      }
      data[column] = body[field];
    }
  }

  for (const [field, column] of [
    ["quietStart", "proactiveQuietStart"],
    ["quietEnd", "proactiveQuietEnd"],
  ] as const) {
    if (field in body) {
      if (!isHour(body[field])) {
        return NextResponse.json({ error: "時刻は0〜23時で指定してください。" }, { status: 400 });
      }
      data[column] = body[field];
    }
  }

  if ("frequency" in body) {
    const frequency = PROACTIVE_FREQUENCIES.find((value) => value === body.frequency);
    if (!frequency) {
      return NextResponse.json({ error: "頻度の指定が正しくありません。" }, { status: 400 });
    }
    data.proactiveFrequency = frequency;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "変更する項目がありません。" }, { status: 400 });
  }

  await db.user.update({ where: { id: user.id }, data });

  return NextResponse.json({ ok: true });
}
