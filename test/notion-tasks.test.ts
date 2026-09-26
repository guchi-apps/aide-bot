import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { createTask, deleteTask, describeTaskError, listTasks, NotionTasksUnavailableError, updateTask } from "../src/lib/notion-tasks.ts";

const TASK_ID = "3be506de-73c3-81be-a15b-f560fe7d28b9";
const DS = "c8e9001c-d2a1-44c9-8ad7-cbe965fcc6d0";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

describe("notion-tasks", () => {
  const realFetch = globalThis.fetch;
  let calls: Call[];
  let responses: { status?: number; json: unknown }[];

  beforeEach(() => {
    calls = [];
    responses = [];
    process.env.NOTION_API_TOKEN = "test-token";
    delete process.env.NOTION_TASK_DATA_SOURCE_ID;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(init.body as string) : undefined,
        headers: init.headers as Record<string, string>,
      });
      const next = responses.shift() ?? { json: {} };
      return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.NOTION_API_TOKEN;
  });

  it("トークン未設定なら Notion へ繋がず閉じる", async () => {
    delete process.env.NOTION_API_TOKEN;
    await assert.rejects(listTasks(), NotionTasksUnavailableError);
    assert.equal(calls.length, 0);
    assert.equal(describeTaskError(new NotionTasksUnavailableError("x")).status, 503);
  });

  it("追加はデータソースを親にして固定のプロパティ名で書く", async () => {
    responses.push({ json: { id: TASK_ID, url: "u", properties: { タイトル: { title: [{ plain_text: "a" }] } } } });
    const task = await createTask({
      title: "a", memo: null, tags: ["生活"], priority: "中", plannedDate: null, dueDate: "2026-09-30", repeat: null, done: false, status: null,
    });
    assert.equal(task.title, "a");
    assert.equal(calls[0].url, "https://api.notion.com/v1/pages");
    assert.equal(calls[0].headers["Notion-Version"], "2025-09-03");
    assert.equal(calls[0].headers.Authorization, "Bearer test-token");
    const body = calls[0].body as { parent: unknown; properties: Record<string, unknown> };
    assert.deepEqual(body.parent, { type: "data_source_id", data_source_id: DS });
    assert.deepEqual(body.properties["優先度"], { select: { name: "中" } });
    assert.deepEqual(body.properties["期限"], { date: { start: "2026-09-30" } });
  });

  it("一覧は完了で絞り、続きのカーソルを返す", async () => {
    responses.push({ json: { results: [{ id: "a", properties: {} }], has_more: true, next_cursor: "c1" } });
    const result = await listTasks({ done: false, limit: 500 });
    assert.equal(result.nextCursor, "c1");
    assert.equal(calls[0].url, `https://api.notion.com/v1/data_sources/${DS}/query`);
    assert.deepEqual(calls[0].body, { page_size: 100, filter: { property: "完了", checkbox: { equals: false } } });
  });

  it("編集・削除の前に、Task DB の行かを確かめる", async () => {
    responses.push({ json: { parent: { type: "data_source_id", data_source_id: "11111111-1111-1111-1111-111111111111" } } });
    await assert.rejects(updateTask(TASK_ID, { done: true }), /Task DBのタスクではありません/);
    responses.push({ json: { parent: { type: "page_id", page_id: "x" } } });
    await assert.rejects(deleteTask(TASK_ID), /Task DBのタスクではありません/);
    assert.ok(calls.every((call) => call.method === "GET"), "確認に落ちた回は書き込まない");
  });

  it("削除はゴミ箱へ移す", async () => {
    responses.push({ json: { parent: { data_source_id: DS.replace(/-/g, "") } } });
    responses.push({ json: {} });
    await deleteTask(TASK_ID);
    assert.equal(calls[1].method, "PATCH");
    assert.deepEqual(calls[1].body, { in_trash: true });
  });

  it("Notionの404・500は呼び出し側のステータスへ直す", async () => {
    responses.push({ status: 404, json: { message: "shared?" } });
    await assert.rejects(listTasks(), (error) => describeTaskError(error).status === 404);
    responses.push({ status: 500, json: {} });
    await assert.rejects(listTasks(), (error) => describeTaskError(error).status === 502);
  });
});
