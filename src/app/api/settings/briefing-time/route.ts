import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";

/**
 * 朝の見通し（#79）を届ける時刻を変更する（#121）。
 *
 * 30分刻みでしか受け付けない。cronの起動頻度（15分ごと）と釣り合わせた粒度で、
 * それより細かく選べても実際に届く時刻の精度は上がらない。
 */

export const dynamic = "force-dynamic";

type Body = { hour?: unknown; minute?: unknown };

function isValidHour(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 23;
}

function isValidMinute(value: unknown): value is number {
  return value === 0 || value === 30;
}

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

  if (!isValidHour(body.hour) || !isValidMinute(body.minute)) {
    return NextResponse.json(
      { error: "時刻は0〜23時・0分か30分のいずれかで指定してください。" },
      { status: 400 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { briefingHour: body.hour, briefingMinute: body.minute },
  });

  return NextResponse.json({ hour: body.hour, minute: body.minute });
}
