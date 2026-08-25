"use client";

import { ArrowUp, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppIcon } from "@/components/brand/app-icon";
import { MAX_MESSAGE_LENGTH } from "@/lib/conversation";
import { cn } from "@/lib/utils";

import { Markdown } from "./markdown";
import type { ChatMessage } from "./types";
import { useChatStream } from "./use-chat-stream";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  initialMessages: ChatMessage[];
};

type Status = "idle" | "thinking" | "streaming";

export function ChatPanel({ conversationId, initialMessages }: Props) {
  const { send: sendMessage, abort } = useChatStream(conversationId);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // 外部サービスを見に行っている間の表示（#46）。返答が流れ始めるまでの数秒を埋める。
  const [activity, setActivity] = useState<{ server: string; tool: string } | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const firstScrollRef = useRef(true);

  // 走っている往復。返答の途中で送られたときに、そこまでの返答を並べ終えるのを待つ（#48）。
  // 待たずに次の発言を足すと、遮られた返答が自分の次の発言より下に出る。
  const turnRef = useRef<Promise<void> | null>(null);
  // 何回目の送信か。待っているあいだにさらに割り込まれたかを見るために持つ。
  const turnSeqRef = useRef(0);

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

  async function runTurn(text: string) {
    setError(null);
    setMessages((previous) => [
      ...previous,
      { id: `local-user-${previous.length}`, role: "USER", content: text },
    ]);
    answerBufferRef.current = "";
    setAnswer("");
    setActivity(null);
    setStatus("thinking");

    const result = await sendMessage(text, {
      onDelta: (delta) => {
        answerBufferRef.current += delta;
        setActivity(null);
        setStatus("streaming");
        scheduleFlush();
      },
      onTool: setActivity,
      onError: setError,
    });

    flushAnswer();

    // 途中で止めた場合も、そこまでの返答は残す。消えると何を聞いたかだけが残る。
    if (result.answer.trim() !== "") {
      setMessages((previous) => [
        ...previous,
        {
          id: `local-assistant-${previous.length}`,
          role: "ASSISTANT",
          content: result.answer,
          interrupted: result.aborted,
        },
      ]);
    }

    answerBufferRef.current = "";
    setAnswer("");
    setActivity(null);
    setStatus("idle");
  }

  /**
   * 送信。返答の途中でも送れる（#48）。
   *
   * 応答中に送られたら、それは割り込み。走っている生成を止め、そこまでの返答が並び終えるのを
   * 待ってから次の往復を始める。待たずに始めると、遮られた返答が自分の次の発言より下に出る。
   */
  function send() {
    const text = input.trim();
    if (text === "" || text.length > MAX_MESSAGE_LENGTH) return;

    setInput("");

    const seq = turnSeqRef.current + 1;
    turnSeqRef.current = seq;

    const previousTurn = turnRef.current;
    abort();

    const turn = (async () => {
      if (previousTurn) await previousTurn;

      const running = runTurn(text);
      // 順番待ちのあいだにさらに割り込まれていたら、この往復も始めた直後に打ち切る。
      // 見ている人はもう次の発言を送っており、この返答を待っていない。
      if (turnSeqRef.current !== seq) abort();
      await running;
    })();

    turnRef.current = turn;
    void turn.finally(() => {
      if (turnRef.current === turn) turnRef.current = null;
    });
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
                  {message.interrupted && <InterruptedNote />}
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
                  <p className="text-sm text-muted">
                    {activity ? (
                      <>
                        {activity.server}を調べています…
                        {activity.tool !== "" && (
                          <span className="ml-1.5 text-[0.6875rem]">（{activity.tool}）</span>
                        )}
                      </>
                    ) : (
                      "考えています…"
                    )}
                  </p>
                ) : (
                  <>
                    <Markdown>{answer}</Markdown>
                    <span className="sr-only">返答を受け取っています</span>
                  </>
                )}
                <button
                  type="button"
                  onClick={abort}
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
            send();
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
                send();
              }}
              rows={1}
              placeholder={busy ? "割り込んで話しかける" : "相談したいことを入力"}
              aria-label="相談したいこと"
              className="max-h-[200px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
            />

            {/*
              応答中でも、書きかけがあるなら送信ボタンのまま出す（#48）。押すと生成を止めて
              そのまま送る。空のときだけ「止める」に入れ替える——書きかけを消してから止める、
              という順序を踏ませないため。
            */}
            {busy && input.trim() === "" ? (
              <button
                type="button"
                onClick={abort}
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
                <span className="sr-only">{busy ? "割り込んで送信" : "送信"}</span>
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
              : busy
                ? "返答の途中でも送れます。送ると生成を止めて続きの相談に移ります"
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

/**
 * 割り込まれた返答であることの印（#48）。
 *
 * 途中で切れた文はそれだけ見ると尻切れの返答に見え、あとから読み返したときに秘書が
 * 言い損ねたのか自分が遮ったのかが分からない。
 */
function InterruptedNote() {
  return (
    <p className="mt-1.5 text-[0.6875rem] text-muted">
      — ここで割り込んだため、返答は途中で止まっています
    </p>
  );
}
