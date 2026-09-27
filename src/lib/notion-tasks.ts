import { fromNotionPage, normalizeTaskId, toNotionProperties, type TaskInput, type TaskPatch, type TaskView } from "@/lib/task-input";

/**
 * Notionの「Task」DBを、Notion REST APIで直接読み書きする（#373）。
 *
 * モデル経由の汎用Notion MCPに任せると、プロパティ名・選択肢・日付形式の取り違えが実行時まで
 * 分からない。ここは項目を `task-input.ts` で検証してから、固定のプロパティ名で書く。
 * Prisma・Supabaseには触れない（テストは `fetch` を差し替えて通す）。
 */

const NOTION_API = "https://api.notion.com/v1";
/** `data_source_id` を親にできる版（Task DBはデータソースで引く）。 */
const NOTION_VERSION = "2025-09-03";
const TIMEOUT_MS = 15_000;

/** 実物のTask DBのデータソースID。シークレットではない設定値なので、環境変数で上書きできる既定として持つ。 */
const DEFAULT_TASK_DATA_SOURCE_ID = "c8e9001c-d2a1-44c9-8ad7-cbe965fcc6d0";

/** `NOTION_API_TOKEN` が無い。呼び出し側は503で返す（経路ごと閉じる）。 */
export class NotionTasksUnavailableError extends Error {}

/** Notionが断った・繋がらなかった。`status` は呼び出し側へ返す値。 */
export class NotionTasksError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function taskDataSourceId(): string {
  return normalizeTaskId(process.env.NOTION_TASK_DATA_SOURCE_ID) ?? DEFAULT_TASK_DATA_SOURCE_ID;
}

async function notion(path: string, init: { method: string; body?: unknown }): Promise<Record<string, unknown>> {
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new NotionTasksUnavailableError("NOTION_API_TOKEN が設定されていません。");

  let response: Response;
  try {
    response = await fetch(`${NOTION_API}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new NotionTasksError(`Notionへ繋がりませんでした（${error instanceof Error ? error.message : "不明"}）。`, 502);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof json.message === "string" ? json.message : "";
    // 404は「無い」か「インテグレーションにDBが共有されていない」のどちらか。呼ぶ側が切り分けられるよう文面へ残す。
    if (response.status === 404) throw new NotionTasksError(`Notionでタスクが見つかりません。${message}`, 404);
    throw new NotionTasksError(`Notionがエラーを返しました（${response.status}）。${message}`, response.status === 429 ? 429 : 502);
  }
  return json;
}

/**
 * 更新・削除の前に、そのページが本当にTask DBの行かを確かめる。
 * `PATCH /v1/pages/{id}` は任意のページを触れてしまうので、idだけを信じて書かない。
 */
async function fetchTaskPage(id: string): Promise<Record<string, unknown>> {
  const page = await notion(`/pages/${id}`, { method: "GET" });
  const parent = page.parent as { data_source_id?: string } | undefined;
  if (normalizeTaskId(parent?.data_source_id) !== taskDataSourceId()) {
    throw new NotionTasksError("そのidはTask DBのタスクではありません。", 404);
  }
  return page;
}

export type TaskListOptions = { done?: boolean; limit?: number; cursor?: string };

export async function listTasks(options: TaskListOptions = {}): Promise<{ tasks: TaskView[]; nextCursor: string | null }> {
  const body: Record<string, unknown> = { page_size: Math.min(Math.max(options.limit ?? 50, 1), 100) };
  if (options.done !== undefined) body.filter = { property: "完了", checkbox: { equals: options.done } };
  if (options.cursor) body.start_cursor = options.cursor;

  const json = await notion(`/data_sources/${taskDataSourceId()}/query`, { method: "POST", body });
  const results = (json.results as Record<string, unknown>[] | undefined) ?? [];
  return {
    tasks: results.map((page) => fromNotionPage(page)),
    nextCursor: json.has_more === true && typeof json.next_cursor === "string" ? json.next_cursor : null,
  };
}

export async function createTask(input: TaskInput): Promise<TaskView> {
  const page = await notion("/pages", {
    method: "POST",
    body: {
      parent: { type: "data_source_id", data_source_id: taskDataSourceId() },
      properties: toNotionProperties(input),
    },
  });
  return fromNotionPage(page);
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskView> {
  await fetchTaskPage(id);
  const page = await notion(`/pages/${id}`, { method: "PATCH", body: { properties: toNotionProperties(patch) } });
  return fromNotionPage(page);
}

/** ゴミ箱へ移す（Notion上から戻せる）。 */
export async function deleteTask(id: string): Promise<void> {
  await fetchTaskPage(id);
  await notion(`/pages/${id}`, { method: "PATCH", body: { in_trash: true } });
}

/** 例外を、呼び出し口（REST・MCP）が返すステータスと文面へ直す。知らない例外は握りつぶさず投げ直す。 */
export function describeTaskError(error: unknown): { status: number; message: string } {
  if (error instanceof NotionTasksUnavailableError) {
    return { status: 503, message: "タスク管理は設定されていません（NOTION_API_TOKEN 未設定）。" };
  }
  if (error instanceof NotionTasksError) return { status: error.status, message: error.message };
  throw error;
}
