import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { isApnsConfigured } from "@/lib/push/apns";
import { isPushConfigured } from "@/lib/push/config";
import { readJsonObject } from "@/lib/json-body";
import { PUSH_KIND_INFO, isPushKind } from "@/lib/push/kinds";
import { sendPushToUser } from "@/lib/push/subscriptions";

/**
 * 登録した端末へ試しに1本送る（#79）。
 *
 * 朝の見通しは1日1回しか出ないため、これが無いと**「登録できたのか」を確かめる手段が
 * 翌朝まで無い。** iOSはホーム画面に追加していないと届かない・通知の許可が端末側の設定で
 * 切られている、といった落とし穴が多く、届かない原因が設定画面からは見えない。
 *
 * モデルは通さない（費用0円）。確かめたいのは経路であって文面ではない。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  // Web Push（VAPID）かiOSアプリ（APNs。#475）のどちらかが使える状態であればよい
  if (!isPushConfigured() && !isApnsConfigured()) {
    return NextResponse.json(
      { error: "通知に必要な設定がサーバー側にありません。管理者に連絡してください。" },
      { status: 503 },
    );
  }

  // 種類を指定したら、その種類と同じタイトル・遷移先の見本を送る（#488）。
  // 種類がオフでも送れる（確かめたいのは届き方）。本文なしは従来どおりの1本。
  const body = await readJsonObject(request);
  const kind = body?.kind;

  if (kind !== undefined && !isPushKind(kind)) {
    return NextResponse.json({ error: "通知の種類の指定が正しくありません。" }, { status: 400 });
  }

  const sample = kind
    ? PUSH_KIND_INFO[kind].sample
    : {
        title: "テスト通知",
        body: "この形で朝の見通しが届きます。押すと相談の画面が開きます。",
        url: "/settings",
      };

  const delivered = await sendPushToUser(user.id, { ...sample, tag: `push-test${kind ? `:${kind}` : ""}` });

  return NextResponse.json({ delivered });
}
