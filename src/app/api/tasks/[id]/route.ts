import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { deleteTask, describeTaskError, updateTask } from "@/lib/notion-tasks";
import { normalizeTaskId, parseTaskPatch } from "@/lib/task-input";

/**
 * Notionの「Task」DBの編集・削除（#373）。削除はNotionのゴミ箱へ移すだけで、Notion上から戻せる。
 * idはTask DBの行かを `notion-tasks.ts` が確かめてから書く。
 */

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const id = normalizeTaskId((await params).id);
  if (!id) return NextResponse.json({ error: "id の形式が正しくありません。" }, { status: 400 });

  const body = await readJsonObject(request);
  if (!body) return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });

  const parsed = parseTaskPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    return NextResponse.json({ task: await updateTask(id, parsed.value) });
  } catch (error) {
    const { status, message } = describeTaskError(error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });

  const id = normalizeTaskId((await params).id);
  if (!id) return NextResponse.json({ error: "id の形式が正しくありません。" }, { status: 400 });

  try {
    await deleteTask(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const { status, message } = describeTaskError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
