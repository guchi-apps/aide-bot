"use client";

import { Check, CircleAlert, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  MAX_TOPIC_CATEGORIES,
  TOPIC_LABEL_MAX,
  TOPIC_SCOPE_MAX,
  TOPIC_SHORT_MAX,
  type TopicCategory,
} from "@/lib/topic-categories";
import { cn } from "@/lib/utils";

/**
 * 話題（#144）として仕入れるニュースの種類の管理（#345）。追加・編集・削除・オン/オフ。
 *
 * 設定の画面ではなく「話題」ページに置いてある。仕入れた結果のすぐ上にある方が、種類を変えた
 * 効果が見える。保存はDB（`/api/settings/topics`）。変えた後は `router.refresh()` で下の一覧の
 * チップ名も引き直す。
 */

type Props = {
  /** サーバー側でDBから読んだ、いまの種類（無効のものも含む）。 */
  initial: TopicCategory[];
};

type Message = { tone: "info" | "error"; text: string };
type Draft = { id: string | null; label: string; short: string; scope: string };
type Article = { title: string; summary: string; url: string; sourceName: string; publishedOn: string };

const EMPTY_DRAFT: Draft = { id: null, label: "", short: "", scope: "" };

async function request(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "保存できませんでした。");
  return data;
}

export function TopicCategoryPicker({ initial }: Props) {
  const router = useRouter();
  const [categories, setCategories] = useState<TopicCategory[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [articles, setArticles] = useState<Article[] | null>(null);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ tone: "info", text: await task() });
      router.refresh();
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "保存できませんでした。" });
    } finally {
      setBusy(false);
    }
  };

  const toggle = (category: TopicCategory) =>
    run(async () => {
      const enabled = !category.enabled;
      await request(`/api/settings/topics/${category.id}`, "PATCH", { enabled });
      const next = categories.map((item) => (item.id === category.id ? { ...item, enabled } : item));
      setCategories(next);
      return next.some((item) => item.enabled) ? "保存しました。次の仕入れから反映されます" : "仕入れを止めました";
    });

  const remove = (category: TopicCategory) => {
    if (!window.confirm(`「${category.label}」を削除しますか？仕入れ済みの記事は残ります。`)) return;
    return run(async () => {
      await request(`/api/settings/topics/${category.id}`, "DELETE");
      setCategories(categories.filter((item) => item.id !== category.id));
      if (draft?.id === category.id) setDraft(null);
      return "削除しました";
    });
  };

  const save = () => {
    if (!draft) return;
    return run(async () => {
      const fields = { label: draft.label, short: draft.short, scope: draft.scope };
      if (draft.id === null) {
        const data = await request("/api/settings/topics", "POST", fields);
        setCategories([...categories, data.category as TopicCategory]);
      } else {
        const data = await request(`/api/settings/topics/${draft.id}`, "PATCH", fields);
        const updated = data.category as TopicCategory;
        setCategories(categories.map((item) => (item.id === updated.id ? updated : item)));
      }
      setDraft(null);
      setArticles(null);
      return "保存しました。次の仕入れから反映されます";
    });
  };

  const preview = async () => {
    if (!draft) return;
    setPreviewing(true);
    setArticles(null);
    setMessage(null);
    try {
      const data = await request("/api/settings/topics/preview", "POST", {
        label: draft.label,
        short: draft.short,
        scope: draft.scope,
      });
      const found = data.articles as Article[];
      setArticles(found);
      setMessage({
        tone: "info",
        text: found.length === 0 ? "記事は見つかりませんでした。説明を変えてみてください" : `${found.length}件見つかりました（保存はされません）`,
      });
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "検索に失敗しました。" });
    } finally {
      setPreviewing(false);
    }
  };

  const startAdd = () => {
    setDraft(EMPTY_DRAFT);
    setArticles(null);
    setMessage(null);
  };

  const startEdit = (category: TopicCategory) => {
    setDraft({ id: category.id, label: category.label, short: category.short, scope: category.scope });
    setArticles(null);
    setMessage(null);
  };

  const full = categories.length >= MAX_TOPIC_CATEGORIES;

  return (
    <div className="flex flex-col gap-3">
      {categories.length === 0 && (
        <p className="text-xs leading-relaxed text-muted">種類がありません。「種類を追加」から作ると、仕入れを始めます。</p>
      )}

      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 md:grid-cols-3">
        {categories.map((category) => (
          <li
            key={category.id}
            className={cn(
              "flex items-start gap-2 rounded-[10px] border px-3 py-2.5",
              category.enabled ? "border-accent/45 bg-accent-surface" : "border-border bg-surface",
            )}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={category.enabled}
              aria-label={`${category.label}を仕入れる`}
              disabled={busy}
              onClick={() => void toggle(category)}
              className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border-[1.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 data-[on=true]:border-accent data-[on=true]:bg-accent data-[on=true]:text-accent-foreground data-[on=false]:border-muted data-[on=false]:bg-surface"
              data-on={category.enabled}
            >
              {category.enabled && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
            </button>
            <span className="min-w-0 flex-1">
              <b className="block break-words text-[0.8125rem] font-semibold">{category.label}</b>
              <span className="block break-words text-[0.6875rem] leading-relaxed text-muted">{category.scope}</span>
            </span>
            <span className="flex shrink-0 gap-0.5">
              <button
                type="button"
                aria-label={`${category.label}を編集`}
                disabled={busy}
                onClick={() => startEdit(category)}
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-rail-active hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
              >
                <Pencil className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={`${category.label}を削除`}
                disabled={busy}
                onClick={() => void remove(category)}
                className="grid size-7 place-items-center rounded-md text-muted hover:bg-rail-active hover:text-danger focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>

      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
          className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-surface p-3"
        >
          <b className="text-[0.8125rem]">{draft.id === null ? "種類を追加" : "種類を編集"}</b>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-[2fr_1fr]">
            <Field label="名前" hint={`${TOPIC_LABEL_MAX}文字まで`}>
              <input
                value={draft.label}
                maxLength={TOPIC_LABEL_MAX}
                onChange={(event) => setDraft({ ...draft, label: event.target.value })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5"
                placeholder="例: 地元のできごと"
              />
            </Field>
            <Field label="短い名前" hint={`${TOPIC_SHORT_MAX}文字まで。空なら名前の先頭`}>
              <input
                value={draft.short}
                maxLength={TOPIC_SHORT_MAX}
                onChange={(event) => setDraft({ ...draft, short: event.target.value })}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5"
                placeholder="例: 地元"
              />
            </Field>
          </div>
          <Field label="集める内容" hint={`${TOPIC_SCOPE_MAX}文字まで。ウェブ検索でこの説明に合う記事を探します`}>
            <textarea
              value={draft.scope}
              maxLength={TOPIC_SCOPE_MAX}
              rows={3}
              onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
              className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5"
              placeholder="例: 東京都内の鉄道の運行情報や、新しい商業施設の開業"
            />
          </Field>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || previewing}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            >
              保存
            </button>
            <button
              type="button"
              disabled={busy || previewing || draft.label.trim() === "" || draft.scope.trim() === ""}
              onClick={() => void preview()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
            >
              <Search className="size-3.5" aria-hidden="true" />
              {previewing ? "検索しています（30秒ほど）…" : "試しに検索"}
            </button>
            <button
              type="button"
              disabled={busy || previewing}
              onClick={() => {
                setDraft(null);
                setArticles(null);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-muted hover:text-foreground disabled:opacity-60"
            >
              閉じる
            </button>
          </div>

          {articles && articles.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {articles.map((article) => (
                <li key={article.url} className="text-xs leading-relaxed">
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline decoration-accent/55 underline-offset-4"
                  >
                    {article.title}
                  </a>
                  <span className="ml-1.5 text-[0.6875rem] text-muted">
                    {[article.sourceName, article.publishedOn].filter((part) => part !== "").join("・")}
                  </span>
                  <p className="m-0 text-muted">{article.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </form>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy || full}
            onClick={startAdd}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-rail-active focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            種類を追加
          </button>
          {full && (
            <span className="ml-2 text-[0.6875rem] text-muted">種類は{MAX_TOPIC_CATEGORIES}件までです</span>
          )}
        </div>
      )}

      <p className="text-[0.6875rem] leading-relaxed text-muted">
        <b className="font-medium text-foreground">すべて外すと仕入れを止めます。</b>
        種類が増えるほど1回の仕入れは重くなります。仕入れと試し検索は相談と同じChatGPTのサブスク枠で動き、費用は付きません（使った量は「使用量」に出ます）。
      </p>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium",
            message.tone === "error" ? "text-danger" : "text-accent",
          )}
        >
          {message.tone === "error" && <CircleAlert className="size-3.5" aria-hidden="true" />}
          {message.text}
        </p>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="font-semibold">
        {label}
        <span className="ml-1.5 text-[0.6875rem] font-normal text-muted">{hint}</span>
      </span>
      {children}
    </label>
  );
}
