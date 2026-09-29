import { NextResponse } from "next/server";

import { APP_VERSION } from "@/lib/app-version";
import { hasValidBearer } from "@/lib/bearer-auth";
import { db } from "@/lib/db";
import { isJsonObject } from "@/lib/json-body";
import { isNoticeIngestAuthorized, NOTICE_BODY_MAX, NOTICE_TITLE_MAX, parseNoticeInput } from "@/lib/notice-ingest";
import { createTask, deleteTask, describeTaskError, listTasks, updateTask } from "@/lib/notion-tasks";
import { ingestNotice } from "@/lib/notices";
import {
  normalizeTaskId,
  parseTaskCreate,
  parseTaskPatch,
  TASK_MEMO_MAX,
  TASK_PRIORITIES,
  TASK_REPEATS,
  TASK_STATUSES,
  TASK_TAGS,
  TASK_TITLE_MAX,
} from "@/lib/task-input";

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

const DATE_NOTE = "YYYY-MM-DD か、タイムゾーン付きのISO 8601（例: 2026-09-30T09:00:00+09:00）。";

/** タスクの項目（`task-input.ts` と同じ。ここに書く選択肢は検証と同じ定数から出す）。 */
const TASK_FIELDS = {
  title: { type: "string", maxLength: TASK_TITLE_MAX, description: "タスクの題名" },
  memo: { type: ["string", "null"], maxLength: TASK_MEMO_MAX, description: "メモ。null か空文字で消す" },
  tags: { type: "array", items: { type: "string", enum: [...TASK_TAGS] }, description: "タグ。渡すと置き換える" },
  priority: { type: ["string", "null"], enum: [...TASK_PRIORITIES, null] },
  plannedDate: { type: ["string", "null"], description: `予定日（自分で決めた実行予定日）。${DATE_NOTE}` },
  dueDate: { type: ["string", "null"], description: `期限（締切）。${DATE_NOTE}` },
  repeat: { type: ["string", "null"], enum: [...TASK_REPEATS, null] },
  done: { type: "boolean", description: "完了" },
  status: { type: ["string", "null"], enum: [...TASK_STATUSES, null], description: "対応状況" },
} as const;

const TASK_ID = {
  type: "string",
  description: "NotionのタスクのページID（aide_task_list の id）。Task DB以外のページは受け付けない",
} as const;

/** Notionの「Task」DBを直接管理するツール（#373）。宛先の利用者は無く、`TASK_API_TOKEN` のBearerで認証した呼び出し元がそのまま操作する。 */
const TASK_TOOLS = [
  {
    name: "aide_task_list",
    description: "Notionの「Task」DBのタスクを一覧します。done で完了・未完了を絞れます。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        done: { type: "boolean", description: "true=完了だけ、false=未完了だけ。省略で全部" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "件数（既定50）" },
        cursor: { type: "string", description: "前回の nextCursor。続きを取るとき" },
      },
    },
  },
  {
    name: "aide_task_create",
    description: "Notionの「Task」DBへタスクを1件追加します。title だけが必須です。",
    inputSchema: { type: "object", additionalProperties: false, properties: TASK_FIELDS, required: ["title"] },
  },
  {
    name: "aide_task_update",
    description: "Notionの「Task」DBのタスクを編集します。渡した項目だけを書き換え、null は「空にする」です。",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: TASK_ID, ...TASK_FIELDS },
      required: ["id"],
    },
  },
  {
    name: "aide_task_delete",
    description:
      "Notionの「Task」DBのタスクをゴミ箱へ移します（Notion上から戻せます）。確認なしで実行されるので、呼ぶ前に利用者へ確かめてください。",
    inputSchema: { type: "object", additionalProperties: false, properties: { id: TASK_ID }, required: ["id"] },
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

async function callTaskTool(name: string, args: Record<string, unknown>) {
  try {
    if (name === "aide_task_list") {
      if (args.done !== undefined && typeof args.done !== "boolean") return textResult("done は true か false で指定してください。", true);
      const limit = args.limit;
      if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100)) {
        return textResult("limit は1〜100の整数で指定してください。", true);
      }
      const cursor = typeof args.cursor === "string" ? args.cursor : undefined;
      return textResult(JSON.stringify(await listTasks({ done: args.done as boolean | undefined, limit, cursor })));
    }

    if (name === "aide_task_create") {
      const parsed = parseTaskCreate(args);
      if (!parsed.ok) return textResult(parsed.error, true);
      return textResult(JSON.stringify({ task: await createTask(parsed.value) }));
    }

    const { id: rawId, ...rest } = args;
    const id = normalizeTaskId(rawId);
    if (!id) return textResult("id はNotionのタスクのページIDで指定してください。", true);

    if (name === "aide_task_update") {
      const parsed = parseTaskPatch(rest);
      if (!parsed.ok) return textResult(parsed.error, true);
      return textResult(JSON.stringify({ task: await updateTask(id, parsed.value) }));
    }

    await deleteTask(id);
    return textResult(JSON.stringify({ deleted: true, id }));
  } catch (error) {
    return textResult(describeTaskError(error).message, true);
  }
}

async function callTool(name: string, rawArgs: unknown) {
  if (TASK_TOOLS.some((tool) => tool.name === name)) {
    if (rawArgs !== undefined && (typeof rawArgs !== "object" || rawArgs === null || Array.isArray(rawArgs))) {
      return textResult("arguments はJSONオブジェクトで指定してください。", true);
    }
    return callTaskTool(name, (rawArgs ?? {}) as Record<string, unknown>);
  }
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
  // トークンは用途で分ける。`NOTICE_INGEST_TOKEN` は外部の呼び出し元へ配ってある値で、これでNotionのタスクの
  // 更新・削除まで通すと、1か所から漏れただけでタスクを消せる（#373の計画レビュー）。タスクのツールは
  // `TASK_API_TOKEN` だけで通し、お知らせのツールは `NOTICE_INGEST_TOKEN` だけで通す。**2つを同じ値にしない**。
  const noticeAllowed = await isNoticeIngestAuthorized(request);
  const taskAllowed = hasValidBearer(request.headers.get("authorization"), process.env.TASK_API_TOKEN);
  if (!noticeAllowed && !taskAllowed) return NextResponse.json({ error: "認証が必要です。" }, { status: 401 });

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
  if (body.method === "tools/list") {
    return response(body.id, { tools: [...(noticeAllowed ? TOOLS : []), ...(taskAllowed ? TASK_TOOLS : [])] });
  }
  if (body.method === "tools/call") {
    if (typeof body.params !== "object" || body.params === null) return errorResponse(body.id, -32602, "params が要ります。");
    const params = body.params as Record<string, unknown>;
    if (typeof params.name !== "string") return errorResponse(body.id, -32602, "ツール名が要ります。");
    const isTaskTool = TASK_TOOLS.some((tool) => tool.name === params.name);
    if (isTaskTool ? !taskAllowed : !noticeAllowed) return errorResponse(body.id, -32001, "このツールを呼ぶ権限がありません。");
    return response(body.id, await callTool(params.name, params.arguments));
  }

  return errorResponse(body.id, -32601, `未対応のメソッドです: ${body.method}`);
}
