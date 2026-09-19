import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";
import { db } from "@/lib/db";
import { isJsonObject } from "@/lib/json-body";
import { isNoticeIngestAuthorized, NOTICE_BODY_MAX, NOTICE_TITLE_MAX, parseNoticeInput } from "@/lib/notice-ingest";
import { ingestNotice } from "@/lib/notices";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

/**
 * 保存される `body` は title・summary・推奨アクションをつないだもの（`composeBody()`）で、上限は
 * それぜんぶを合わせた長さに掛かる。フィールドごとの `maxLength` だけでは表せないので、呼ぶ側が
 * 読む説明文にも書く。
 */
const BODY_LIMIT_NOTE = `title・summary・recommendedAction を合わせて${NOTICE_BODY_MAX}文字以内にすること（title は本文の先頭にも入るため2回数える）。`;

const TOOLS = [
  {
    name: "aide_create_notification",
    description: "AIDEの秘書画面へ、利用者に知らせる情報を登録します。",
    inputSchema: noticeSchema("schedule"),
  },
  {
    name: "aide_create_task_candidate",
    description: "AIDEの秘書画面へ、対応が必要なタスク候補を登録します。",
    inputSchema: noticeSchema("task"),
  },
  {
    name: "aide_save_daily_brief",
    description: "AIDEの秘書画面へ、その日のブリーフを登録します。",
    inputSchema: noticeSchema("daily-brief"),
  },
] as const;

function noticeSchema(kind: string) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      email: { type: "string", description: "登録先のGoogleアカウントのメールアドレス" },
      title: { type: "string", maxLength: NOTICE_TITLE_MAX, description: "情報の短いタイトル" },
      summary: {
        type: "string",
        maxLength: NOTICE_BODY_MAX,
        description: `利用者へ知らせる要約。${BODY_LIMIT_NOTE}`,
      },
      source: { type: "string", description: "情報源（例: gmail, calendar）" },
      dedupeKey: { type: "string", description: "同じ情報を重複登録しないための安定したキー" },
      priority: { type: "string", enum: ["LOW", "NORMAL", "URGENT"] },
      url: { type: ["string", "null"], description: "元データへのリンク" },
      recommendedAction: {
        type: "string",
        maxLength: NOTICE_BODY_MAX,
        description: `推奨アクション。無ければ空文字。${BODY_LIMIT_NOTE}`,
      },
      showAt: { type: ["string", "null"], description: "表示開始時刻（ISO 8601）" },
      expiresAt: { type: ["string", "null"], description: "表示期限（ISO 8601）" },
    },
    required: ["email", "title", "summary", "source", "dedupeKey"],
    description: `内部種別は ${kind} として保存されます。`,
  };
}

function response(id: JsonRpcRequest["id"], result: unknown) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, result },
    { headers: { "MCP-Protocol-Version": PROTOCOL_VERSION } },
  );
}

function errorResponse(id: JsonRpcRequest["id"], code: number, message: string) {
  return NextResponse.json(
    { jsonrpc: "2.0", id: id ?? null, error: { code, message } },
    { headers: { "MCP-Protocol-Version": PROTOCOL_VERSION } },
  );
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** 保存する `body`。title は先頭にも入る（#247の前からの形。変えると画面に出る文面が変わる）。 */
function composeBody(title: string, summary: string, recommendedAction: string): string {
  return [title, summary, recommendedAction ? `推奨アクション: ${recommendedAction}` : ""].filter(Boolean).join("\n");
}

/** `callTool()` がツール名と title/summary/body を確かめた後にだけ呼ぶ。 */
function toolInput(toolName: string, args: Record<string, unknown>, title: string, body: string): unknown {
  return {
    email: args.email,
    source: args.source,
    kind: toolName === "aide_create_notification" ? "schedule" : toolName === "aide_create_task_candidate" ? "task" : "daily-brief",
    dedupeKey: args.dedupeKey,
    title,
    body,
    priority: args.priority,
    url: args.url,
    showAt: args.showAt,
    expiresAt: args.expiresAt,
  };
}

async function callTool(name: string, rawArgs: unknown) {
  if (!TOOLS.some((tool) => tool.name === name)) return textResult(`未知のツールです: ${name}`, true);
  if (typeof rawArgs !== "object" || rawArgs === null) return textResult("arguments はJSONオブジェクトで指定してください。", true);

  const args = rawArgs as Record<string, unknown>;
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const summary = typeof args.summary === "string" ? args.summary.trim() : "";
  if (title === "" || summary === "") return textResult("title と summary が要ります。", true);
  if (title.length > NOTICE_TITLE_MAX) return textResult(`title は${NOTICE_TITLE_MAX}文字までです（いま${title.length}文字）。`, true);

  // `parseNoticeInput()` にも同じ上限があるが、そちらは `body` を名指しする。ツールの入力に `body` は
  // 無く、呼ぶ側はどの項目を縮めればよいか分からない（#247）ので、ここで先に項目名で返す。
  const recommendedAction = typeof args.recommendedAction === "string" ? args.recommendedAction.trim() : "";
  const body = composeBody(title, summary, recommendedAction);
  if (body.length > NOTICE_BODY_MAX) {
    const over = body.length - NOTICE_BODY_MAX;
    return textResult(
      `title・summary・recommendedAction を合わせて${NOTICE_BODY_MAX}文字までです（title は本文の先頭にも入るため2回数えます）。` +
        `いまは${body.length}文字で、${over}文字超えています。summary か recommendedAction を${over}文字以上短くして、もう一度呼んでください。`,
      true,
    );
  }

  const parsed = parseNoticeInput(toolInput(name, args, title, body));
  if (typeof parsed === "string") return textResult(parsed, true);

  const user = await db.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (!user) return textResult("その宛先の利用者が見つかりません。", true);

  const notice = await ingestNotice(user.id, parsed.input);
  return textResult(JSON.stringify({ accepted: true, id: notice.id, kind: parsed.input.kind }));
}

export async function POST(request: Request) {
  if (!isNoticeIngestAuthorized(request)) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONとして読めませんでした。" }, { status: 400 });
  }

  // 本文が `null` だと `body.jsonrpc` を読んだ時点でTypeErrorになり、呼ぶ側には500しか見えない（#262）。
  // JSONとして読めたが形が違うものは、JSON-RPCのエラーで返す（`id` は取れないのでnull）。
  if (!isJsonObject(raw)) return errorResponse(null, -32600, "JSON-RPCリクエストが不正です。");
  const body: JsonRpcRequest = raw;

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return errorResponse(body.id, -32600, "JSON-RPCリクエストが不正です。");
  }

  if (body.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
  if (body.method === "ping") return response(body.id, {});
  if (body.method === "initialize") {
    return response(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "aide-bot", version: APP_VERSION },
    });
  }
  if (body.method === "tools/list") return response(body.id, { tools: TOOLS });
  if (body.method === "tools/call") {
    if (typeof body.params !== "object" || body.params === null) return errorResponse(body.id, -32602, "params が要ります。");
    const params = body.params as Record<string, unknown>;
    if (typeof params.name !== "string") return errorResponse(body.id, -32602, "ツール名が要ります。");
    return response(body.id, await callTool(params.name, params.arguments));
  }

  return errorResponse(body.id, -32601, `未対応のメソッドです: ${body.method}`);
}
