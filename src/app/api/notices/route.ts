import { timingSafeEqual } from "node:crypto";

import { NoticePriority } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { ingestNotice, type NoticeInput } from "@/lib/notices";

/**
 * 他アプリが「利用者に知らせたいこと」を積む（#93）。**利用者のいない経路。**
 *
 * ```
 * curl -fsS -X POST http://127.0.0.1:3103/api/notices \
 *   -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
 *   -d '{"email":"...","source":"aide","kind":"schedule","dedupeKey":"2026-08-27-dental",
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

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // timingSafeEqual は長さが違うと例外を投げるため、先に長さを見る。
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.NOTICE_INGEST_TOKEN ?? "";
  if (expected === "") return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;

  return safeEqual(header.slice("Bearer ".length), expected);
}

/** 列の長さに収まらない値は、DBのエラーにする前にここで弾く。 */
const LIMITS = { source: 40, kind: 40, dedupeKey: 120, url: 500 } as const;

function shortString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) return null;
  return trimmed;
}

function parseDate(value: unknown): Date | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function parsePriority(value: unknown): NoticePriority | undefined {
  if (value === undefined || value === null) return NoticePriority.NORMAL;
  if (typeof value !== "string") return undefined;
  const known = Object.values(NoticePriority).find((priority) => priority === value.toUpperCase());
  return known;
}

/** 受け取ったJSONを1件ぶんに均す。読めない値は落とさず、どこが駄目かを返す。 */
function parseBody(raw: unknown): { input: NoticeInput; email: string } | string {
  if (typeof raw !== "object" || raw === null) return "JSONのオブジェクトを送ってください。";

  const value = raw as Record<string, unknown>;

  const email = shortString(value.email, 254);
  if (!email) return "email が要ります。";

  const source = shortString(value.source, LIMITS.source);
  if (!source) return `source が要ります（${LIMITS.source}文字まで）。`;

  const kind = shortString(value.kind, LIMITS.kind);
  if (!kind) return `kind が要ります（${LIMITS.kind}文字まで）。`;

  const dedupeKey = shortString(value.dedupeKey, LIMITS.dedupeKey);
  if (!dedupeKey) return `dedupeKey が要ります（${LIMITS.dedupeKey}文字まで）。`;

  // 本文は吹き出しの材料。長すぎるものは、秘書が短くする前に入力を膨らませるだけなので断る。
  const body = shortString(value.body, 500);
  if (!body) return "body が要ります（500文字まで）。";

  const url = value.url === undefined || value.url === null ? null : shortString(value.url, LIMITS.url);
  if (url === null && value.url !== undefined && value.url !== null) {
    return `url が長すぎます（${LIMITS.url}文字まで）。`;
  }

  const priority = parsePriority(value.priority);
  if (!priority) return "priority は LOW / NORMAL / URGENT のいずれかです。";

  const showAt = parseDate(value.showAt);
  if (showAt === undefined) return "showAt が日時として読めません。";

  const expiresAt = parseDate(value.expiresAt);
  if (expiresAt === undefined) return "expiresAt が日時として読めません。";

  return { email, input: { source, kind, dedupeKey, body, url, priority, showAt, expiresAt } };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    // 未設定なのか値が違うのかを区別して返さない。外から設定状況を探れないようにする。
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONとして読めませんでした。" }, { status: 400 });
  }

  const parsed = parseBody(raw);
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
