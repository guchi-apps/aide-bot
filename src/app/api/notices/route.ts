import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ingestNotice } from "@/lib/notices";
import { isNoticeIngestAuthorized, parseNoticeInput } from "@/lib/notice-ingest";

/**
 * 他アプリが「利用者に知らせたいこと」を積む（#93）。**利用者のいない経路。**
 *
 * ```
 * curl -fsS -X POST http://127.0.0.1:3103/api/notices \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{"email":"...","source":"aide","kind":"schedule","dedupeKey":"2026-08-27-dental","title":"歯科の予約",
 *        "body":"13時から歯科の予約です。ここから25分かかります","priority":"URGENT",
 *        "expiresAt":"2026-08-27T04:00:00Z"}'
 * ```
 *
 * ## なぜHTTPなのか
 *
 * 他アプリは同じVPS・同じMariaDBに同居しているので、`Notice` テーブルへ直接INSERTさせる
 * こともできる。**それはしない。** 直に書かせると、このスキーマが外部の実装に固定されて
 * 列ひとつ足すたびに全アプリを直すことになる。受け口をHTTPに閉じておけば、変えてよいのは
 * このハンドラの入口の形だけになる。
 *
 * ## 認証
 *
 * 相手はアプリのサーバーなので、Cookieもセッションも無い。共有シークレットのBearerで守る
 * （`POST /api/briefing`（#79）と同じ）。**`NOTICE_INGEST_TOKEN` が未設定なら、この経路
 * ごと閉じる。** 「未設定なら誰でも叩ける」にすると、設定漏れがそのまま公開の書き込み口になる。
 *
 * 宛先は `email`（`User.email` は一意）で指定する。積む側にaide-bot内部のIDを知らせない
 * ため、そして利用者が増えても形が変わらないため。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isNoticeIngestAuthorized(request)) {
    // 未設定なのか値が違うのかを区別して返さない。外から設定状況を探れないようにする。
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONとして読めませんでした。" }, { status: 400 });
  }

  const parsed = parseNoticeInput(raw);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const user = await db.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "その宛先の利用者が見つかりません。" }, { status: 404 });
  }

  const notice = await ingestNotice(user.id, parsed.input);

  return NextResponse.json({ id: notice.id, accepted: true });
}
