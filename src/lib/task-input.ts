/**
 * Notionの「Task」DBへ書く入力の検証と、Notionのプロパティ表記への変換（#373）。
 *
 * **Notion・DB・Prismaのどれにも触れない純粋な関数だけを置く**（`test/task-input.test.ts` が固定する）。
 * 項目名・選択肢は、実物のDB（`collection://c8e9001c-d2a1-44c9-8ad7-cbe965fcc6d0`）のスキーマを
 * 取得して写したもの。Notion側で選択肢を足したら、ここも足すまでは「知らない値」として弾く
 * （黙って新しい選択肢を作らせない。それが「確実な変更」のための専用口を作る理由）。
 */

export const TASK_TITLE_MAX = 200;
/** Notionのrich_textは1要素2,000文字まで。 */
export const TASK_MEMO_MAX = 2000;

export const TASK_TAGS = ["仕事", "祭り", "趣味", "生活"] as const;
export const TASK_PRIORITIES = ["高", "中", "低"] as const;
export const TASK_REPEATS = ["なし", "毎日", "毎週", "毎月", "毎年"] as const;
export const TASK_STATUSES = ["対応しない"] as const;

export type TaskInput = {
  title: string;
  memo: string | null;
  tags: string[];
  priority: string | null;
  plannedDate: string | null;
  dueDate: string | null;
  repeat: string | null;
  done: boolean;
  status: string | null;
};

/** 編集で渡す項目。渡した項目だけを書き換え、`null` は「空にする」。 */
export type TaskPatch = Partial<TaskInput>;

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const FIELD_KEYS = ["title", "memo", "tags", "priority", "plannedDate", "dueDate", "repeat", "done", "status"] as const;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** `YYYY-MM-DD` か、タイムゾーン付きのISO 8601。存在しない日付（2026-13-99・2026-02-31）は落とす。 */
export function isTaskDate(value: string): boolean {
  if (!DATE_ONLY.test(value) && !DATE_TIME.test(value)) return false;
  if (!isCalendarDate(value.slice(0, 10))) return false;
  return !Number.isNaN(new Date(DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value).getTime());
}

function isCalendarDate(day: string): boolean {
  const date = new Date(`${day}T00:00:00Z`);
  // 2026-13-99 は Invalid Date で、toISOString() が RangeError を投げる。先に見る。
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

/** Notionのページid。ハイフンの有無どちらでも受け、ハイフン付きの小文字へ揃えて返す。 */
export function normalizeTaskId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.trim().replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function oneOf(field: string, value: unknown, allowed: readonly string[]): Parsed<string> {
  if (typeof value !== "string" || !allowed.includes(value)) {
    return { ok: false, error: `${field} は ${allowed.join("・")} のどれかで指定してください。` };
  }
  return { ok: true, value };
}

/** 1項目を検証する。`undefined`（渡されていない）は呼び出し側が先に除く。 */
function parseField(key: (typeof FIELD_KEYS)[number], value: unknown): Parsed<unknown> {
  switch (key) {
    case "title": {
      if (typeof value !== "string" || value.trim() === "") return { ok: false, error: "title は空にできません。" };
      const title = value.trim();
      if (title.length > TASK_TITLE_MAX) {
        return { ok: false, error: `title は${TASK_TITLE_MAX}文字までです（いま${title.length}文字）。` };
      }
      return { ok: true, value: title };
    }
    case "memo": {
      if (value === null) return { ok: true, value: null };
      if (typeof value !== "string") return { ok: false, error: "memo は文字列か null で指定してください。" };
      if (value.length > TASK_MEMO_MAX) {
        return { ok: false, error: `memo は${TASK_MEMO_MAX}文字までです（いま${value.length}文字）。` };
      }
      return { ok: true, value: value === "" ? null : value };
    }
    case "tags": {
      if (!Array.isArray(value)) return { ok: false, error: `tags は ${TASK_TAGS.join("・")} の配列で指定してください。` };
      const seen = new Set<string>();
      for (const tag of value) {
        const checked = oneOf("tags の各要素", tag, TASK_TAGS);
        if (!checked.ok) return checked;
        seen.add(checked.value);
      }
      return { ok: true, value: [...seen] };
    }
    case "priority":
    case "repeat":
    case "status": {
      if (value === null) return { ok: true, value: null };
      const allowed = key === "priority" ? TASK_PRIORITIES : key === "repeat" ? TASK_REPEATS : TASK_STATUSES;
      return oneOf(key, value, allowed);
    }
    case "plannedDate":
    case "dueDate": {
      if (value === null) return { ok: true, value: null };
      if (typeof value !== "string" || !isTaskDate(value)) {
        return {
          ok: false,
          error: `${key} は YYYY-MM-DD か、タイムゾーン付きのISO 8601（例: 2026-09-30T09:00:00+09:00）で指定してください。`,
        };
      }
      return { ok: true, value };
    }
    case "done": {
      if (typeof value !== "boolean") return { ok: false, error: "done は true か false で指定してください。" };
      return { ok: true, value };
    }
  }
}

function parseFields(body: Record<string, unknown>): Parsed<Record<string, unknown>> {
  const unknown = Object.keys(body).filter((key) => !(FIELD_KEYS as readonly string[]).includes(key));
  if (unknown.length > 0) {
    return { ok: false, error: `知らない項目です: ${unknown.join("・")}（使えるのは ${FIELD_KEYS.join("・")}）。` };
  }

  const out: Record<string, unknown> = {};
  for (const key of FIELD_KEYS) {
    if (body[key] === undefined) continue;
    const parsed = parseField(key, body[key]);
    if (!parsed.ok) return parsed;
    out[key] = parsed.value;
  }
  return { ok: true, value: out };
}

/** 追加。title だけが必須で、残りは省略できる（tags は空、done は未完了）。 */
export function parseTaskCreate(body: Record<string, unknown>): Parsed<TaskInput> {
  if (body.title === undefined) return { ok: false, error: "title が要ります。" };

  const parsed = parseFields(body);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  return {
    ok: true,
    value: {
      title: v.title as string,
      memo: (v.memo as string | null | undefined) ?? null,
      tags: (v.tags as string[] | undefined) ?? [],
      priority: (v.priority as string | null | undefined) ?? null,
      plannedDate: (v.plannedDate as string | null | undefined) ?? null,
      dueDate: (v.dueDate as string | null | undefined) ?? null,
      repeat: (v.repeat as string | null | undefined) ?? null,
      done: (v.done as boolean | undefined) ?? false,
      status: (v.status as string | null | undefined) ?? null,
    },
  };
}

/** 編集。1項目も渡っていない呼び出しは、何も変えないのに成功したように見えるので断る。 */
export function parseTaskPatch(body: Record<string, unknown>): Parsed<TaskPatch> {
  const parsed = parseFields(body);
  if (!parsed.ok) return parsed;
  if (Object.keys(parsed.value).length === 0) {
    return { ok: false, error: `変更する項目がありません（${FIELD_KEYS.join("・")} のどれかを渡してください）。` };
  }
  if (parsed.value.title === null) return { ok: false, error: "title は空にできません。" };
  return { ok: true, value: parsed.value as TaskPatch };
}

// --- Notionのプロパティ表記 -------------------------------------------------

type NotionProperties = Record<string, unknown>;

function dateProperty(value: string | null) {
  return { date: value === null ? null : { start: value } };
}

/** 渡された項目だけをNotionのプロパティにする（追加でも編集でも同じ形）。 */
export function toNotionProperties(input: TaskPatch): NotionProperties {
  const props: NotionProperties = {};
  if (input.title !== undefined) props["タイトル"] = { title: [{ text: { content: input.title } }] };
  if (input.memo !== undefined) {
    props["メモ"] = { rich_text: input.memo === null ? [] : [{ text: { content: input.memo } }] };
  }
  if (input.tags !== undefined) props["タグ"] = { multi_select: input.tags.map((name) => ({ name })) };
  if (input.priority !== undefined) props["優先度"] = { select: input.priority === null ? null : { name: input.priority } };
  if (input.plannedDate !== undefined) props["予定日"] = dateProperty(input.plannedDate);
  if (input.dueDate !== undefined) props["期限"] = dateProperty(input.dueDate);
  if (input.repeat !== undefined) props["繰り返し"] = { select: input.repeat === null ? null : { name: input.repeat } };
  if (input.done !== undefined) props["完了"] = { checkbox: input.done };
  if (input.status !== undefined) props["対応状況"] = { select: input.status === null ? null : { name: input.status } };
  return props;
}

export type TaskView = TaskInput & { id: string; url: string };

type NotionText = { plain_text?: string };
type NotionPage = {
  id?: string;
  url?: string;
  properties?: Record<string, Record<string, unknown> | undefined>;
};

function plain(value: unknown): string {
  return Array.isArray(value) ? (value as NotionText[]).map((part) => part.plain_text ?? "").join("") : "";
}

function selectName(prop: Record<string, unknown> | undefined): string | null {
  const select = prop?.select as { name?: string } | null | undefined;
  return select?.name ?? null;
}

function dateStart(prop: Record<string, unknown> | undefined): string | null {
  const date = prop?.date as { start?: string } | null | undefined;
  return date?.start ?? null;
}

/** Notionのページを、呼ぶ側へ返す形にする。 */
export function fromNotionPage(page: NotionPage): TaskView {
  const p = page.properties ?? {};
  const memo = plain(p["メモ"]?.rich_text);
  return {
    id: page.id ?? "",
    url: page.url ?? "",
    title: plain(p["タイトル"]?.title),
    memo: memo === "" ? null : memo,
    tags: ((p["タグ"]?.multi_select as { name?: string }[] | undefined) ?? []).map((tag) => tag.name ?? ""),
    priority: selectName(p["優先度"]),
    plannedDate: dateStart(p["予定日"]),
    dueDate: dateStart(p["期限"]),
    repeat: selectName(p["繰り返し"]),
    done: p["完了"]?.checkbox === true,
    status: selectName(p["対応状況"]),
  };
}
