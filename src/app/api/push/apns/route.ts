import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { deleteApnsDevice, isApnsConfigured, saveApnsDevice } from "@/lib/push/apns";
import { isApnsEnvironment, parseDeviceToken } from "@/lib/push/apns-core";
import { countSubscriptions } from "@/lib/push/subscriptions";

/**
 * iOSアプリ（殻。#441）のAPNsデバイストークンを登録・解除する（#475）。
 *
 * 呼ぶのは殻が `WKWebView` の中で行う `fetch`（ログインCookieが届く側）。Web Pushの
 * `/api/push` と同じく、`/api/*` はmiddlewareが素通しにするのでログイン判定はここで行う。
 * 認証情報（`APNS_*`）が未設定なら登録も受け付けない——登録できたのに何も来ない状態を作らない。
 */

export const dynamic = "force-dynamic";

type Body = { token?: unknown; environment?: unknown };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  if (!isApnsConfigured()) {
    return NextResponse.json(
      { error: "アプリの通知に必要な設定がサーバー側にありません。管理者に連絡してください。" },
      { status: 503 },
    );
  }

  const body: Body | null = await readJsonObject(request);
  const token = parseDeviceToken(body?.token);
  if (!body || token === null || !isApnsEnvironment(body.environment)) {
    return NextResponse.json({ error: "端末の情報が正しくありません。" }, { status: 400 });
  }

  await saveApnsDevice({
    userId: user.id,
    token,
    environment: body.environment,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ deviceCount: await countSubscriptions(user.id) });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body: Body | null = await readJsonObject(request);
  const token = parseDeviceToken(body?.token);
  if (!body || token === null) {
    return NextResponse.json({ error: "端末の情報が正しくありません。" }, { status: 400 });
  }

  await deleteApnsDevice(user.id, token);

  return NextResponse.json({ deviceCount: await countSubscriptions(user.id) });
}
