"use client";

import { Keyboard, Mic, Repeat, Settings2, Square, Volume2, VolumeX, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatMessage } from "@/components/chat/types";
import { useTalkMode } from "@/components/chat/talk-mode-context";
import { parseStreamEvent, readString } from "@/lib/sse";
import { startRecognition, type RecognitionHandle } from "@/lib/speech/recognition";
import {
  RATE_MAX,
  RATE_MIN,
  SpeechReader,
  isSpeechSynthesisSupported,
  primeSpeechSynthesis,
  watchJapaneseVoices,
} from "@/lib/speech/synthesis";
import {
  updateVoiceSettings,
  useRecognitionSupported,
  useVoiceSettings,
} from "@/lib/speech/voice-settings";
import { cn } from "@/lib/utils";

import { Orb, type OrbState } from "./orb";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  initialMessages: ChatMessage[];
};

const STATUS_LABEL: Record<OrbState, string> = {
  idle: "待っています",
  listening: "聞いています",
  thinking: "考えています",
  speaking: "話しています",
};

/**
 * 音声で秘書と対話する画面（#27）。
 *
 * 聞き取りも読み上げもブラウザ内蔵の Web Speech API で行い、返答の生成は「書く」と同じ
 * `POST /api/chat` を使う。声で話した内容も同じ相談スレッドへ残るため、「書く」に
 * 切り替えれば文字で読み返せる。
 *
 * ひと往復は idle → listening → thinking → speaking → idle と進む。「続けて話す」が入なら
 * 最後の idle を挟まずに listening へ戻る。読み上げ中にマイクを開かないのは、自分の声を
 * 聞き返して延々と往復し続けるのを防ぐため。
 */
export function VoicePanel({ conversationId, initialMessages }: Props) {
  const router = useRouter();
  const { setMode } = useTalkMode();

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<OrbState>("idle");
  const [heard, setHeard] = useState("");
  const [lastUser, setLastUser] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);

  const settings = useVoiceSettings();
  const supported = useRecognitionSupported();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const recognitionRef = useRef<RecognitionHandle | null>(null);
  const readerRef = useRef<SpeechReader | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const finalRef = useRef("");
  const primedRef = useRef(false);
  const reactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // コールバックの中からは、その時点の最新の設定を見たい。stateを直接読むと
  // 聞き取りを始めた時点の値で固定される。
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 「読み上げ終わり → また聞き取り」と「聞き取り終わり → 送信」で互いを呼ぶため、
  // 実体はrefに置いて参照だけを渡す。
  const beginListeningRef = useRef<() => void>(() => {});
  const sendRef = useRef<(text: string) => void>(() => {});

  // 選べる声は端末が非同期に用意する。揃った時点で入れ直す。
  useEffect(() => watchJapaneseVoices(setVoices), []);

  const bump = useCallback(() => {
    setReacting(true);
    if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
    reactTimerRef.current = setTimeout(() => setReacting(false), 600);
  }, []);

  /** 動いているものを全部止める。画面を離れるときと、利用者が止めたとき。 */
  const stopEverything = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    readerRef.current?.cancel();
    readerRef.current = null;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
      stopEverything();
    };
  }, [stopEverything]);

  const send = useCallback(
    async (text: string) => {
      const controller = new AbortController();
      abortRef.current = controller;

      setError(null);
      setLastUser(text);
      setReply("");
      setStatus("thinking");
      setMessages((previous) => [
        ...previous,
        { id: `local-user-${previous.length}`, role: "USER", content: text },
      ]);

      const reader =
        settingsRef.current.speak && isSpeechSynthesisSupported()
          ? new SpeechReader({
              voiceURI: settingsRef.current.voiceURI,
              rate: settingsRef.current.rate,
              onStart: () => setStatus("speaking"),
              onDrain: () => {
                readerRef.current = null;
                if (settingsRef.current.continuous) beginListeningRef.current();
                else setStatus("idle");
              },
            })
          : null;
      readerRef.current = reader;

      let answer = "";
      let createdConversationId: string | null = null;
      let failed = false;

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 音声で聞くと伝える。返答が読み上げ向きの短さになる。
          body: JSON.stringify({ conversationId, message: text, mode: "voice" }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(
            detail?.error ?? "送信できませんでした。通信状況を確認して、もう一度お試しください。",
          );
        }

        const streamReader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await streamReader.read();
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
              const delta = readString(event.data, "text") ?? "";
              answer += delta;
              setReply(answer);
              reader?.push(delta);
            } else if (event.name === "error") {
              failed = true;
              setError(readString(event.data, "message") ?? "返答の生成に失敗しました。");
            }
          }
        }
      } catch (caught) {
        // 「止める」を押した場合もここに来る。利用者が止めたものはエラーとして出さない。
        if (!controller.signal.aborted) {
          failed = true;
          setError(caught instanceof Error ? caught.message : "送信できませんでした。");
        }
      } finally {
        abortRef.current = null;

        if (answer.trim() !== "") {
          setMessages((previous) => [
            ...previous,
            { id: `local-assistant-${previous.length}`, role: "ASSISTANT", content: answer },
          ]);
        }

        if (controller.signal.aborted) {
          // 利用者が止めた。読み上げも一緒に畳んで待機へ戻す。
          reader?.cancel();
          readerRef.current = null;
          setStatus("idle");
        } else if (reader && !failed && answer.trim() !== "") {
          // ここから先は読み上げが終わるのを待つ。次の状態は onDrain が決める。
          reader.finish();
        } else {
          reader?.cancel();
          readerRef.current = null;
          // 失敗したときに聞き取りへ戻すと、同じ失敗を繰り返しかねない。待機で止める。
          if (!failed && settingsRef.current.continuous) beginListeningRef.current();
          else setStatus("idle");
        }

        if (conversationId === null && createdConversationId !== null) {
          // 新しく作られたスレッドのURLへ移す。同じ内容がDBにあるので表示は変わらない。
          router.replace(`/c/${createdConversationId}`);
        }
        // 一覧の並び順とタイトルを取り直す。
        router.refresh();
      }
    },
    [conversationId, router],
  );

  useEffect(() => {
    sendRef.current = (text: string) => void send(text);
  }, [send]);

  const beginListening = useCallback(() => {
    if (recognitionRef.current) return;

    setError(null);
    setHeard("");
    finalRef.current = "";
    setStatus("listening");

    const handle = startRecognition({
      onInterim: (text) => {
        setHeard(text);
        if (text !== "") bump();
      },
      onFinal: (text) => {
        finalRef.current += text;
      },
      onSpeechStart: bump,
      onError: (message) => {
        if (message) setError(message);
      },
      onEnd: () => {
        recognitionRef.current = null;
        setHeard("");

        const text = finalRef.current.trim();
        finalRef.current = "";

        if (text === "") {
          setStatus("idle");
          return;
        }

        sendRef.current(text);
      },
    });

    if (!handle) {
      setStatus("idle");
      return;
    }

    recognitionRef.current = handle;
  }, [bump]);

  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  /** 中央の大きなボタン。いまの状態によって「始める」と「止める」が入れ替わる。 */
  function onPrimaryButton() {
    if (!primedRef.current) {
      // iOSは「画面を触った流れ」で一度 speak() を通しておかないと、以降が無音になる。
      primeSpeechSynthesis();
      primedRef.current = true;
    }

    if (status === "listening") {
      recognitionRef.current?.stop();
      return;
    }

    if (status === "thinking" || status === "speaking") {
      stopEverything();
      setStatus("idle");
      return;
    }

    beginListening();
  }

  const busy = status !== "idle";
  const speakable = isSpeechSynthesisSupported();

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-[10px] border border-border bg-background text-muted transition-colors hover:bg-rail-active md:right-6 md:top-4"
        >
          <Settings2 className="size-4" aria-hidden="true" />
          <span className="sr-only">声の設定</span>
        </button>

        {settingsOpen && (
          <div className="absolute right-3 top-14 z-20 w-[min(320px,calc(100%-1.5rem))] rounded-2xl border border-border bg-surface p-4 shadow-xl md:right-6 md:top-16">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">声の設定</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-rail-active"
              >
                <X className="size-3.5" aria-hidden="true" />
                <span className="sr-only">閉じる</span>
              </button>
            </div>

            <label className="flex items-center justify-between gap-3 py-2 text-sm">
              返事を読み上げる
              <input
                type="checkbox"
                checked={settings.speak}
                onChange={(event) => updateVoiceSettings({ speak: event.target.checked })}
                className="size-4 accent-accent"
              />
            </label>

            <label className="flex items-center justify-between gap-3 py-2 text-sm">
              続けて話す
              <input
                type="checkbox"
                checked={settings.continuous}
                onChange={(event) => updateVoiceSettings({ continuous: event.target.checked })}
                className="size-4 accent-accent"
              />
            </label>

            <label className="flex flex-col gap-1.5 py-2 text-sm">
              声
              <select
                value={settings.voiceURI ?? ""}
                onChange={(event) => updateVoiceSettings({ voiceURI: event.target.value || null })}
                className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">端末におまかせ</option>
                {voices.map((voice) => (
                  <option key={voice.voiceURI} value={voice.voiceURI}>
                    {voice.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 py-2 text-sm">
              <span className="flex items-center justify-between">
                読み上げの速さ
                <span className="text-xs text-muted">{settings.rate.toFixed(1)}倍</span>
              </span>
              <input
                type="range"
                min={RATE_MIN}
                max={RATE_MAX}
                step={0.1}
                value={settings.rate}
                onChange={(event) => updateVoiceSettings({ rate: Number(event.target.value) })}
                className="accent-accent"
              />
            </label>

            {!speakable && (
              <p className="mt-1 text-xs leading-relaxed text-muted">
                このブラウザは読み上げに対応していません。返事は画面の文字でご確認ください。
              </p>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 py-6 text-center">
          <Orb
            state={status}
            reacting={reacting}
            className="size-[168px] md:size-[184px] lg:size-[200px]"
          />

          <p className="inline-flex items-center gap-2 rounded-full bg-accent-surface px-3.5 py-1 text-xs font-bold text-accent">
            <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
            <span aria-live="polite">{STATUS_LABEL[status]}</span>
          </p>

          <div className="flex w-full max-w-[36rem] flex-col gap-3">
            {status === "listening" ? (
              <p className="min-h-[3.5rem] text-lg leading-relaxed font-medium">
                {heard === "" ? (
                  <span className="text-muted">お話しください…</span>
                ) : (
                  heard
                )}
              </p>
            ) : (
              <>
                {lastUser && (
                  <p className="text-xs text-muted">
                    さっき話したこと — <span className="font-medium text-foreground">「{lastUser}」</span>
                  </p>
                )}
                <p className="min-h-[3.5rem] whitespace-pre-wrap text-lg leading-relaxed font-medium">
                  {reply !== "" ? (
                    reply
                  ) : status === "thinking" ? (
                    <span className="text-muted">返事を考えています…</span>
                  ) : messages.length === 0 ? (
                    <span className="text-muted">
                      下のマイクを押して、そのまま話しかけてください。
                    </span>
                  ) : (
                    <span className="text-muted">続けて話しかけてください。</span>
                  )}
                </p>
              </>
            )}

            {!supported && (
              <p
                role="alert"
                className="rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-muted"
              >
                このブラウザでは聞き取りが使えません。
                <button
                  type="button"
                  onClick={() => setMode("write")}
                  className="mx-1 underline underline-offset-2 hover:text-foreground"
                >
                  「書く」に切り替える
                </button>
                と、文字で相談できます。
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-surface px-4 py-2.5 text-sm text-danger"
              >
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 border-t border-border bg-surface px-6 pb-6 pt-4 md:gap-8">
          <button
            type="button"
            onClick={() => updateVoiceSettings({ continuous: !settings.continuous })}
            aria-pressed={settings.continuous}
            className="flex w-[4.5rem] flex-col items-center gap-1.5 text-[0.6875rem] text-muted"
          >
            <span
              className={cn(
                "grid size-11 place-items-center rounded-[13px] border transition-colors",
                settings.continuous
                  ? "border-transparent bg-accent-surface text-accent"
                  : "border-border bg-background text-foreground",
              )}
            >
              <Repeat className="size-[18px]" aria-hidden="true" />
            </span>
            続けて話す
          </button>

          <button
            type="button"
            onClick={onPrimaryButton}
            disabled={!supported && !busy}
            className={cn(
              "grid size-[76px] place-items-center rounded-full transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40",
              busy
                ? "border border-border bg-surface text-foreground"
                : "bg-accent text-accent-foreground shadow-[0_0_0_8px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
            )}
          >
            {busy ? (
              <Square className="size-6 fill-current" aria-hidden="true" />
            ) : (
              <Mic className="size-7" aria-hidden="true" />
            )}
            <span className="sr-only">
              {busy ? "止める" : "話しかける"}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopEverything();
              setMode("write");
            }}
            className="flex w-[4.5rem] flex-col items-center gap-1.5 text-[0.6875rem] text-muted"
          >
            <span className="grid size-11 place-items-center rounded-[13px] border border-border bg-background text-foreground">
              <Keyboard className="size-[18px]" aria-hidden="true" />
            </span>
            文字で送る
          </button>
        </div>
      </div>

      {/* 画面が広いときだけ、いまの相談のやり取りを右へ添える。声だけだと直前しか追えない。 */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-surface lg:flex">
        <h2 className="border-b border-border px-4 py-3 text-xs font-medium text-muted">
          この相談の記録
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-3.5">
          {messages.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">
              話しかけると、ここにやり取りが残ります。
            </p>
          ) : (
            messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-1">
                <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted">
                  {message.role === "USER" ? "わたし" : "秘書"}
                </span>
                <p
                  className={cn(
                    "whitespace-pre-wrap break-words text-xs leading-relaxed",
                    message.role === "USER" &&
                      "rounded-[10px_10px_10px_3px] bg-accent-surface px-2.5 py-1.5",
                  )}
                >
                  {message.content}
                </p>
              </div>
            ))
          )}
        </div>
        <p className="flex items-center gap-1.5 border-t border-border px-4 py-2.5 text-[0.6875rem] text-muted">
          {settings.speak ? (
            <Volume2 className="size-3.5" aria-hidden="true" />
          ) : (
            <VolumeX className="size-3.5" aria-hidden="true" />
          )}
          {settings.speak ? "読み上げは入" : "読み上げは切"}
        </p>
      </aside>
    </div>
  );
}
