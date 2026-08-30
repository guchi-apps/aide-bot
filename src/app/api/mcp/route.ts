import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { isNoticeIngestAuthorized, parseNoticeInput } from "@/lib/notice-ingest";
import { ingestNotice } from "@/lib/notices";

export const dynamic = "force-dynamic";

const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
};

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
      title: { type: "string", description: "情報の短いタイトル" },
      summary: { type: "string", description: "利用者へ知らせる要約" },
      source: { type: "string", description: "情報源（例: gmail, calendar）" },
      dedupeKey: { type: "string", description: "同じ情報を重複登録しないための安定したキー" },
      priority: { type: "string", enum: ["LOW", "NORMAL", "URGENT"] },
      url: { type: ["string", "null"], description: "元データへのリンク" },
      recommendedAction: { type: "string", description: "推奨アクション。無ければ空文字" },
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

function toolInput(toolName: string, args: Record<string, unknown>): unknown {
  const tool = TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) return null;

  const title = typeof args.title === "string" ? args.title.trim() : "";
  const summary = typeof args.summary === "string" ? args.summary.trim() : "";
  const recommendedAction = typeof args.recommendedAction === "string" ? args.recommendedAction.trim() : "";
  return {
    email: args.email,
    source: args.source,
    kind: toolName === "aide_create_notification" ? "schedule" : toolName === "aide_create_task_candidate" ? "task" : "daily-brief",
    dedupeKey: args.dedupeKey,
    title,
    body: [title, summary, recommendedAction ? `推奨アクション: ${recommendedAction}` : ""].filter(Boolean).join("\n"),
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

  const parsed = parseNoticeInput(toolInput(name, args));
  if (typeof parsed === "string") return textResult(parsed, true);

  const user = await db.user.findUnique({ where: { email: parsed.email }, select: { id: true } });
  if (!user) return textResult("その宛先の利用者が見つかりません。", true);

  const notice = await ingestNotice(user.id, parsed.input);
  return textResult(JSON.stringify({ accepted: true, id: notice.id, kind: parsed.input.kind }));
}

export async function POST(request: Request) {
  if (!isNoticeIngestAuthorized(request)) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });

  let body: JsonRpcRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSONとして読めませんでした。" }, { status: 400 });
  }

  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return errorResponse(body.id, -32600, "JSON-RPCリクエストが不正です。");
  }

  if (body.method === "notifications/initialized") return new NextResponse(null, { status: 202 });
  if (body.method === "ping") return response(body.id, {});
  if (body.method === "initialize") {
    return response(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "aide-bot", version: "0.10.0" },
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
