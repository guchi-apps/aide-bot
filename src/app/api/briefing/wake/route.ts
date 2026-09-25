import { NextResponse, after } from "next/server";

import { checkWakeSignal, runWakeBriefing } from "@/lib/briefing";
import { db } from "@/lib/db";
import { bearerToken, hashWakeToken } from "@/lib/wake-token";

/**
 * 起きた合図を受けて、朝の見通しをその場で届ける（#233）。
 *
 * iPhoneの個人用オートメーション「アラーム ▸ 停止したとき」から叩く。**合図が届かなかった日は、
 * これまでどおりcron（`/api/briefing`）が設定時刻に送る**——設定時刻は「遅くともこの時刻」の
 * 意味になる。
 *
 * ## 「アラームを止めた」は「起きた」ではない
 *
 * 睡眠の判定はdayspanが持っている。ショートカット側で、dayspanの `/api/shortcuts/sleep/stop` の
 * 応答が `status: "saved"`（記録中の睡眠を止めた）のときだけここを叩くよう案内している
 * （設定の画面）。**それでもサーバー側に下限（日本時間4:00）を置く**——夜ふかし中にリマインダーを
 * 止めた合図で見通しを送ると、`NotificationLog` の抑制でその日の分を使い切る。
 *
 * ## 応答
 *
 * 成否によらず `{ ok, status, message }` の形にする（dayspanの§40と同じ）。ショートカットの
 * 「辞書の値を取得」（キー `message`）→「通知を表示」へそのまま流せる。オートメーションは人が
 * 見ていないところで走るので、効いていないことに気付ける場所がほかに無い。
 *
 * **生成は応答を返した後に走らせる**（`after()`）。Codexの往復は最大180秒かかり、ショートカットは
 * そこまで待てない。届いたかどうかはPushで分かる。
 */

export const dynamic = "force-dynamic";

/** 生成は `after()` で走る。`/api/briefing` と同じ上限にそろえる。 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const token = bearerToken(request);
  const user = token
    ? await db.user.findUnique({
        where: { wakeTokenHash: hashWakeToken(token) },
        select: { id: true, briefingHour: true, briefingMinute: true },
      })
    : null;

  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        status: "unauthorized",
        message: "トークンが正しくありません。Morrowの設定の画面で発行し直してください。",
      },
      { status: 401 },
    );
  }

  const now = new Date();

  // 最後に合図を受け取った時刻。設定の画面に出して、オートメーションが効いているかを読めるようにする。
  // **受け付けなかった回も進める**——下限より前・送信済みでも、ショートカット自体は届いている。
  await db.user.update({ where: { id: user.id }, data: { wakeTokenUsedAt: now } });

  const check = await checkWakeSignal(user.id, now);
  if (!check.accepted) {
    return NextResponse.json({ ok: true, status: check.status, message: check.message });
  }

  after(() => runWakeBriefing(user, now));

  return NextResponse.json({ ok: true, status: "accepted", message: check.message });
}
