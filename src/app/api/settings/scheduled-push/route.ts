import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { db } from "@/lib/db";
import { readJsonObject } from "@/lib/json-body";
import { listTopicCategories } from "@/lib/topic-category-store";
import {
  SCHEDULED_PUSH_LIMIT,
  daysToMask,
  SCHEDULED_PUSH_ALL,
} from "@/lib/scheduled-push-rule";

/**
 * 定時のお知らせ（#344）の登録・変更・削除。読むのはcronの経路なのでDBに持つ。
 * 時刻は30分刻みだけ受け付ける（cronの起動頻度と揃える）。
 */

export const dynamic = "force-dynamic";

const SELECT = { id: true, daysMask: true, hour: true, minute: true, category: true, enabled: true } as const;

function unauthorized() {
  return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** 本文から `daysMask` / `hour` / `minute` / `category` を検証して取り出す。渡した項目だけ。 */
async function parseFields(userId: string, body: Record<string, unknown>) {
  const data: { daysMask?: number; hour?: number; minute?: number; category?: string; enabled?: boolean } = {};

  if ("days" in body) {
    if (!Array.isArray(body.days)) return { error: "曜日は配列で指定してください。" };
    const mask = daysToMask(body.days as number[]);
    if (mask === 0) return { error: "曜日を1つ以上選んでください。" };
    data.daysMask = mask;
  }
  if ("hour" in body) {
    if (typeof body.hour !== "number" || !Number.isInteger(body.hour) || body.hour < 0 || body.hour > 23) {
      return { error: "時刻は0〜23時で指定してください。" };
    }
    data.hour = body.hour;
  }
  if ("minute" in body) {
    if (body.minute !== 0 && body.minute !== 30) return { error: "分は0か30で指定してください。" };
    data.minute = body.minute;
  }
  if ("category" in body) {
    // 種類は利用者ごとに追加・削除できる（#345）ので、いま持っている種類と突き合わせる。
    const known = body.category === SCHEDULED_PUSH_ALL ||
      (typeof body.category === "string" &&
        (await listTopicCategories(userId)).some((category) => category.id === body.category));
    if (!known) return { error: "話題の種類の指定が正しくありません。" };
    data.category = body.category as string;
  }
  if ("enabled" in body) {
    if (typeof body.enabled !== "boolean") return { error: "enabled は真偽値で指定してください。" };
    data.enabled = body.enabled;
  }

  return { data };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJsonObject(request);
  if (!body) return badRequest("リクエストの形式が正しくありません。");

  const parsed = await parseFields(user.id, body);
  if ("error" in parsed) return badRequest(parsed.error as string);
  const { data } = parsed;
  if (data.daysMask === undefined || data.hour === undefined || data.minute === undefined || data.category === undefined) {
    return badRequest("曜日・時刻・話題の種類を指定してください。");
  }

  const count = await db.scheduledPush.count({ where: { userId: user.id } });
  if (count >= SCHEDULED_PUSH_LIMIT) {
    return badRequest(`登録できるのは${SCHEDULED_PUSH_LIMIT}件までです。`);
  }

  const created = await db.scheduledPush.create({
    data: {
      userId: user.id,
      daysMask: data.daysMask,
      hour: data.hour,
      minute: data.minute,
      category: data.category,
      enabled: data.enabled ?? true,
    },
    select: SELECT,
  });

  return NextResponse.json({ schedule: created }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJsonObject(request);
  if (!body) return badRequest("リクエストの形式が正しくありません。");
  if (typeof body.id !== "string") return badRequest("id を指定してください。");

  const parsed = await parseFields(user.id, body);
  if ("error" in parsed) return badRequest(parsed.error as string);
  if (Object.keys(parsed.data).length === 0) return badRequest("変更する項目がありません。");

  // 他人の設定は触れない（userIdとの組で更新する）。
  // 曜日・時刻を変えたら登録時刻を取り直す（変えた直後に、過ぎた時刻の分が発火しないように。`isDue()`）。
  const rescheduled = "daysMask" in parsed.data || "hour" in parsed.data || "minute" in parsed.data;
  const result = await db.scheduledPush.updateMany({
    where: { id: body.id, userId: user.id },
    data: rescheduled ? { ...parsed.data, createdAt: new Date() } : parsed.data,
  });
  if (result.count === 0) return NextResponse.json({ error: "設定が見つかりません。" }, { status: 404 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await readJsonObject(request);
  if (!body || typeof body.id !== "string") return badRequest("id を指定してください。");

  await db.scheduledPush.deleteMany({ where: { id: body.id, userId: user.id } });
  return NextResponse.json({ ok: true });
}
