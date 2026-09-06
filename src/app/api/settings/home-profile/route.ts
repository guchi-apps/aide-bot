import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { refreshHomeProfile } from "@/lib/home-profile";

/**
 * 自宅の情報をNotionから取り込み直す（#167）。
 *
 * 普段はcronの経路（`/api/briefing`）が1日1回だけ走らせる。ここは**設定の画面のボタンから
 * 押したときだけ**の入口で、間隔を見ずにその場で取り込む——繋いだ直後・Notionを直した直後に
 * 翌朝まで待たせないため。
 *
 * `/api/*` はmiddlewareがリダイレクトせず素通しするので、ログイン判定はここで行う。
 */

export const dynamic = "force-dynamic";

/** Notionの検索と読み込みで道具を数回呼ぶ。既定のタイムアウトでは足りないことがある。 */
export const maxDuration = 180;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  try {
    const result = await refreshHomeProfile(user.id);

    if (result.status === "empty") {
      return NextResponse.json({
        status: "empty",
        // 前に取り込めていれば、それはそのまま残っている（本文は消さない）。
        profile: user.homeProfile,
      });
    }

    return NextResponse.json({ status: "saved", profile: result.profile });
  } catch (error) {
    console.error("[aide-bot] 自宅の情報の取り込みに失敗した", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "取り込めませんでした。" },
      { status: 502 },
    );
  }
}
