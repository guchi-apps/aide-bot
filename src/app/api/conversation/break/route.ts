import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { breakContextManually } from "@/lib/context-break";
import { jstTimeLabel } from "@/lib/day-key";
import { primaryConversation } from "@/lib/day-log";

/**
 * 会話を区切る（#322）。以後の応答へ渡す履歴と要約だけを新しい文脈へ切り替える。
 *
 * **記録は消さない。** 発言・書き込みの記録・通知・使用量はそのままで、日別の記録から読める。
 * 生成中に押されても待たない——走っている往復の返答は、区切りの1ms前の時刻で旧文脈へ保存される
 * （`replySavedAt()`）ので、新しい会話へ古い話が入ることも、返答が失われることも無い。
 *
 * proxy.ts は `/api/*` を素通しするので、ログイン判定はここで行う。
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const conversation = await primaryConversation(user.id);
  const at = await breakContextManually(conversation.id, new Date());

  // 区切る発言が無かった（すでに区切った直後など）回は、何もしなかったことだけを返す。
  return NextResponse.json({ broke: at !== null, time: at ? jstTimeLabel(at) : null });
}
