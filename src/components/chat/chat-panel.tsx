"use client";

import { ArrowUp, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppIcon } from "@/components/app-icon";
import { MAX_MESSAGE_LENGTH } from "@/lib/conversation";
import { cn } from "@/lib/utils";

import { Markdown } from "./markdown";
import type { ChatMessage } from "./types";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  initialMessages: ChatMessage[];
};

type Status = "idle" | "thinking" | "streaming";

type StreamEvent = { name: string; data: Record<string, unknown> };

/** SSEの1ブロック（空行区切り）をイベント名とJSONに分ける。 */
function parseStreamEvent(block: string): StreamEvent | null {
  let name = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    const data = JSON.parse(dataLines.join("\n")) as unknown;
    if (typeof data !== "object" || data === null) return null;
    return { name, data: data as Record<string, unknown> };
  } catch {
    return null;
  }
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? value : null;
}

export function ChatPanel({ conversationId, initialMessages }: Props) {
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const firstScrollRef = useRef(true);

  // 生成中の返答をdeltaごとに描画すると、そのたびにMarkdownを組み直すことになり、
  // 長い返答の後半で目に見えて詰まる。溜めてから間引いて反映する。
  const answerBufferRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushAnswer = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    setAnswer(answerBufferRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      setAnswer(answerBufferRef.current);
    }, 60);
  }, []);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // 新しい発言が増えたら末尾へ。開いた直後だけはアニメーションさせない。
  useEffect(() => {
    const behavior = firstScrollRef.current ? "auto" : "smooth";
    firstScrollRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [messages, answer, status]);

  // 入力欄を中身の高さに合わせる。上限を超えたら中でスクロールさせる。
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [input]);

  async function send() {
    const text = input.trim();
    if (text === "" || status !== "idle") return;

    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setInput("");
    setMessages((previous) => [
      ...previous,
      { id: `local-user-${previous.length}`, role: "USER", content: text },
    ]);
    answerBufferRef.current = "";
    setAnswer("");
    setStatus("thinking");

    let createdConversationId: string | null = null;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          detail?.error ?? "送信できませんでした。通信状況を確認して、もう一度お試しください。",
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSEのイベント区切りは空行。最後の断片は次のチャンクと繋げる。
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseStreamEvent(block);
          if (!event) continue;

          if (event.name === "meta") {
            createdConversationId = readString(event.data, "conversationId");
          } else if (event.name === "delta") {
            answerBufferRef.current += readString(event.data, "text") ?? "";
            setStatus("streaming");
            scheduleFlush();
          } else if (event.name === "error") {
            setError(readString(event.data, "message") ?? "返答の生成に失敗しました。");
          }
        }
      }
    } catch (caught) {
      // 「止める」を押した場合もここに来る。利用者が止めたものはエラーとして出さない。
      if (!controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : "送信できませんでした。");
      }
    } finally {
      abortRef.current = null;
      flushAnswer();

      const finished = answerBufferRef.current;
      if (finished.trim() !== "") {
        setMessages((previous) => [
          ...previous,
          { id: `local-assistant-${previous.length}`, role: "ASSISTANT", content: finished },
        ]);
      }
      answerBufferRef.current = "";
      setAnswer("");
      setStatus("idle");

      if (conversationId === null && createdConversationId !== null) {
        // 新しく作られたスレッドのURLへ移す。同じ内容がDBにあるので表示は変わらない。
        router.replace(`/c/${createdConversationId}`);
      }
      // 一覧の並び順とタイトルを取り直す。
      router.refresh();
    }
  }

  const isEmpty = messages.length === 0 && status === "idle";
  const overLimit = input.length > MAX_MESSAGE_LENGTH;
  const busy = status !== "idle";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={cn(
            "mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 md:px-7 md:py-6",
            isEmpty && "h-full justify-center",
          )}
        >
          {isEmpty && (
            <div className="text-center">
              <p className="text-lg font-medium">今日はどんなご相談でしょうか。</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                思いついたことをそのまま書いてください。話題が変わるときは「新しい相談」で分けると、
                あとから探しやすくなります。
              </p>
            </div>
          )}

          {messages.map((message) =>
            message.role === "USER" ? (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-[16px_16px_4px_16px] border border-accent/25 bg-accent-surface px-4 py-2.5 text-sm md:max-w-[30rem]">
                  {message.content}
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex gap-3">
                <SecretaryAvatar />
                <div className="min-w-0 flex-1">
                  <SecretaryLabel />
                  <Markdown>{message.content}</Markdown>
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="flex gap-3">
              <SecretaryAvatar />
              <div className="min-w-0 flex-1">
                <SecretaryLabel />
                {status === "thinking" ? (
                  <p className="text-sm text-muted">考えています…</p>
                ) : (
                  <>
                    <Markdown>{answer}</Markdown>
                    <span className="sr-only">返答を受け取っています</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-rail-active"
                >
                  <Square className="size-2.5 fill-current" aria-hidden="true" />
                  生成を止める
                </button>
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-surface px-4 py-2.5 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="px-4 pb-4 pt-2 md:px-7 md:pb-5">
        <form
          className="mx-auto w-full max-w-3xl"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2.5 rounded-[18px] border border-border bg-surface py-2.5 pl-4 pr-2.5 focus-within:border-accent">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                // 日本語入力の変換確定のEnterで送信しないよう、変換中は素通しする。
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                void send();
              }}
              rows={1}
              placeholder="相談したいことを入力"
              aria-label="相談したいこと"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
            />

            {busy ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-opacity hover:opacity-90"
              >
                <Square className="size-3.5 fill-current" aria-hidden="true" />
                <span className="sr-only">生成を止める</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={input.trim() === "" || overLimit}
                className="grid size-9 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground transition-opacity hover:opacity-90 disabled:bg-border disabled:text-muted"
              >
                <ArrowUp className="size-4" aria-hidden="true" />
                <span className="sr-only">送信</span>
              </button>
            )}
          </div>

          <p
            className={cn(
              "mt-2 text-center text-[0.6875rem] text-muted",
              overLimit && "text-danger",
            )}
          >
            {overLimit
              ? `一度に送れるのは${MAX_MESSAGE_LENGTH.toLocaleString()}文字までです（現在 ${input.length.toLocaleString()}文字）`
              : "Enter で送信 / Shift + Enter で改行"}
          </p>
        </form>
      </div>
    </div>
  );
}

function SecretaryAvatar() {
  return <AppIcon className="mt-0.5 size-[26px] shrink-0" />;
}

function SecretaryLabel() {
  return (
    <div className="mb-1 text-[0.6875rem] font-bold tracking-[0.08em] text-muted">秘書</div>
  );
}
