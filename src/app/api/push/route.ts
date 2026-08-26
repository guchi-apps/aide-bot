import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { isPushConfigured } from "@/lib/push/config";
import {
  countSubscriptions,
  deleteSubscription,
  saveSubscription,
  type PushSubscriptionInput,
} from "@/lib/push/subscriptions";

/**
 * 端末の購読を登録・解除する（#79）。
 *
 * 接続の画面（`/api/connections`）と違いフォームのPOSTにできない。購読を作れるのは
 * `navigator.serviceWorker` と `PushManager` を触ったブラウザ側だけで、その結果を
 * サーバーへ渡す必要があるため。**ここだけはクライアントJSに依存する。**
 *
 * proxy.ts は `/api/*` をリダイレクトせず素通しするので、ログイン判定はここで行う。
 */

export const dynamic = "force-dynamic";

type Body = { subscription?: unknown };

function parseSubscription(value: unknown): PushSubscriptionInput | null {
  if (typeof value !== "object" || value === null) return null;

  const { endpoint, keys } = value as { endpoint?: unknown; keys?: unknown };
  if (typeof endpoint !== "string" || endpoint === "") return null;
  // 相手はブラウザベンダーのPushサービス。httpsに限る。
  if (!endpoint.startsWith("https://")) return null;

  if (typeof keys !== "object" || keys === null) return null;
  const { p256dh, auth } = keys as { p256dh?: unknown; auth?: unknown };
  if (typeof p256dh !== "string" || p256dh === "") return null;
  if (typeof auth !== "string" || auth === "") return null;
  // 長すぎる値は列に入らない。base64urlのp256dhは88文字、authは24文字前後。
  if (p256dh.length > 255 || auth.length > 255) return null;

  return { endpoint, keys: { p256dh, auth } };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "通知に必要な設定がサーバー側にありません。管理者に連絡してください。" },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const subscription = parseSubscription(body.subscription);
  if (!subscription) {
    return NextResponse.json({ error: "購読の情報が正しくありません。" }, { status: 400 });
  }

  await saveSubscription({
    userId: user.id,
    subscription,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ deviceCount: await countSubscriptions(user.id) });
}

export async function DELETE(request: Request) {
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

  const subscription = parseSubscription(body.subscription);
  if (!subscription) {
    return NextResponse.json({ error: "購読の情報が正しくありません。" }, { status: 400 });
  }

  await deleteSubscription(user.id, subscription.endpoint);

  return NextResponse.json({ deviceCount: await countSubscriptions(user.id) });
}
