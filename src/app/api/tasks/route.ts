import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { createTask, describeTaskError, listTasks } from "@/lib/notion-tasks";
import { parseTaskCreate } from "@/lib/task-input";

/**
 * Notionの「Task」DBの一覧・追加（#373）。`/api/*` はmiddlewareが素通しするので、ログイン判定はここで行う。
 * `NOTION_API_TOKEN` 未設定なら503で閉じる。
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const done = params.get("done");
  if (done !== null && done !== "true" && done !== "false") {
    return NextResponse.json({ error: "done は true か false で指定してください。" }, { status: 400 });
  }
  const limitParam = params.get("limit");
  const limit = limitParam === null ? undefined : Number(limitParam);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
    return NextResponse.json({ error: "limit は1〜100の整数で指定してください。" }, { status: 400 });
  }

  try {
    const result = await listTasks({ done: done === null ? undefined : done === "true", limit, cursor: params.get("cursor") ?? undefined });
    return NextResponse.json(result);
  } catch (error) {
    const { status, message } = describeTaskError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const parsed = parseTaskCreate(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    return NextResponse.json({ task: await createTask(parsed.value) }, { status: 201 });
  } catch (error) {
    const { status, message } = describeTaskError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
