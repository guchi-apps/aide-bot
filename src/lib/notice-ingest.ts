import { timingSafeEqual } from "node:crypto";

import { NoticePriority } from "@prisma/client";

import type { NoticeInput } from "@/lib/notices";

/** 外部の無人実行経路からお知らせを受け取るための共有認証。 */
export function isNoticeIngestAuthorized(request: Request): boolean {
  const expected = process.env.NOTICE_INGEST_TOKEN ?? "";
  if (expected === "") return false;

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return false;

  const actual = Buffer.from(header.slice("Bearer ".length));
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

const LIMITS = { source: 40, kind: 40, dedupeKey: 120, url: 500 } as const;

function shortString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed.length <= max ? trimmed : null;
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
  return Object.values(NoticePriority).find((priority) => priority === value.toUpperCase());
}

/** HTTPとMCPで共通利用する、お知らせ1件ぶんの入力検証。 */
export function parseNoticeInput(raw: unknown): { input: NoticeInput; email: string } | string {
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

  const body = shortString(value.body, 500);
  if (!body) return "body が要ります（500文字まで）。";

  const title = value.title === undefined || value.title === null ? undefined : shortString(value.title, 120);
  if (title === null) return "title が長すぎます（120文字まで）。";

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

  return { email, input: { source, kind, dedupeKey, title, body, url, priority, showAt, expiresAt } };
}
