"use client";

import { ArrowUp, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type BubblePayload,
  EMPTY_BUBBLE_PAYLOAD,
  samePayload,
} from "@/components/voice/use-notice";
import { isStandalone, useVoiceConversation } from "@/components/voice/use-voice-conversation";
import { MAX_MESSAGE_LENGTH } from "@/lib/conversation";
import { jstTimeLabel } from "@/lib/day-key";
import { noteRecognition } from "@/lib/speech/recognition";
import { voiceSettingsSnapshot } from "@/lib/speech/voice-settings";
import { cn } from "@/lib/utils";

import { CompactedNote, EntryList, SecretaryAvatar, SecretaryLabel } from "./entry-list";
import { Markdown } from "./markdown";
import type { ChatEntry } from "./types";
import { SecretaryLine } from "./secretary-line";
import { useChatStream } from "./use-chat-stream";
import { useLocalEntries } from "./use-local-entries";
import { useNudges, type NudgeMessage } from "./use-nudge";
import { useThrottledText } from "./use-throttled-text";
import { VoiceBar } from "./voice-bar";

type Props = {
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。日付の区切りに使う（#157）。 */
  todayKey: string;
  /** 要約へ畳んである発言の数（#157）。0なら印を出さない。 */
  compactedCount: number;
};

type Status = "idle" | "thinking" | "streaming";

export function ChatPanel({ initialEntries, todayKey, compactedCount }: Props) {
  const { send: sendMessage, abort } = useChatStream();

  const { entries, setEntries, addUser, addAssistant, addRecord } = useLocalEntries(initialEntries);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // 外部サービスを見に行っている間の表示（#46）。返答が流れ始めるまでの数秒を埋める。
  const [activity, setActivity] = useState<{ server: string; tool: string } | null>(null);
  // 声で話している最中か（#279）。入れ替わるのは入力欄のところだけで、記録の流れは残る。
  const [voiceOpen, setVoiceOpen] = useState(false);
  // 秘書の一言（#279）の材料。問い合わせは声かけ（#278）の `useNudges()` が持っている。
  const [bubble, setBubble] = useState<BubblePayload>(EMPTY_BUBBLE_PAYLOAD);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const firstScrollRef = useRef(true);

  // 走っている往復。返答の途中で送られたときに、そこまでの返答を並べ終えるのを待つ（#48）。
  // 待たずに次の発言を足すと、遮られた返答が自分の次の発言より下に出る。
  const turnRef = useRef<Promise<void> | null>(null);
  // 何回目の送信か。待っているあいだにさらに割り込まれたかを見るために持つ。
  const turnSeqRef = useRef(0);

  // 生成中の返答をdeltaごとに描画すると、そのたびにMarkdownを組み直すことになり、
  // 長い返答の後半で目に見えて詰まる。溜めてから間引いて反映する（「話す」と共通。#228）。
  const {
    text: answer,
    push: pushAnswer,
    set: setAnswerText,
    reset: resetAnswer,
  } = useThrottledText();

  /**
   * 声で話す（#279）。**往復の実装は「話す」の全画面と同じ `useVoiceConversation()`。**
   *
   * 聞き取った発言も返事も、文字で送ったものと同じ `entries` / `answer` へ流し込む。
   * 記録の流れが1本のまま続くので、声と文字を行き来しても読み返しかたが変わらない。
   */
  const voice = useVoiceConversation({
    onUserMessage: (text) => {
      setError(null);
      resetAnswer();
      setActivity(null);
      addUser(text);
    },
    // 届くのはそこまでの全文。文字のときと同じく溜めて間引いて描く。
    onReply: setAnswerText,
    onRecord: addRecord,
    /*
     * 返答が確定したら流れへ積み、生成中の表示は畳む。**読み上げはこの後も続く**ので、
     * ここで畳まないと同じ文が記録と生成中の欄に二重に並ぶ。
     */
    onAssistantMessage: (message) => {
      addAssistant(message);
      resetAnswer();
    },
  });

  // 新しい発言が増えたら末尾へ。開いた直後だけはアニメーションさせない。
  useEffect(() => {
    const behavior = firstScrollRef.current ? "auto" : "smooth";
    firstScrollRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior, block: "end" });
  }, [entries, answer, status, voice.status]);

  /**
   * 秘書から話しかけてきた発言を流れの末尾へ足す（#278）。
   *
   * **同じidは二度足さない。** タブへ戻った回・問い合わせが重なった回に、同じ声かけが
   * もう一度返ってくることがある（基準の時刻は最後に受け取ったぶんまでしか進まない）。
   */
  const onNudge = useCallback((nudges: NudgeMessage[]) => {
    setEntries((previous) => {
      const known = new Set(previous.map((entry) => entry.id));
      const added = nudges
        .filter((nudge) => !known.has(nudge.id))
        .map<ChatEntry>((nudge) => ({
          kind: "message",
          id: nudge.id,
          role: "ASSISTANT",
          content: nudge.content,
          proactive: true,
          // 時刻は積まれた時刻から作る（#280）。`new Date()` で作ると、問い合わせの間隔
          // （最大3分）ぶんだけ、再読み込みした後の表示とずれる。
          time: jstTimeLabel(new Date(nudge.createdAt)),
        }));

      return added.length === 0 ? previous : [...previous, ...added];
    });
  }, [setEntries]);

  /**
   * 秘書の一言の材料を受け取る（#279）。同じ中身が返った回は入れ替えない（輪が作り直されて、
   * いま出している一言の残り時間が毎回25秒に戻る。#101）。
   */
  const onBubble = useCallback((next: BubblePayload) => {
    setBubble((previous) => (samePayload(previous, next) ? previous : next));
  }, []);

  /*
   * 生成中は問い合わせも足し込みも見送る（順序の詳細は `use-nudge.ts`）。
   *
   * **声の往復も「生成中」に数える**（#279）。声で話した往復は `status` には現れない（別のフックが
   * 持っている）ので、`voice.answering`（考えている・読み上げている最中）も見る。足さないと、
   * 声の返答が保存されるまでのあいだに声かけが流れの末尾へ入り、画面の並びだけが実際の順序と
   * 食い違う——#278が避けようとしている形そのもの。**聞き取り中は見送らない**（利用者の発言は
   * 話し終えてから足すので、その前に入った声かけは保存の順とも一致する）。
   */
  useNudges(onNudge, status !== "idle" || voice.answering, onBubble);

  // 入力欄を中身の高さに合わせる。上限を超えたら中でスクロールさせる。
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
  }, [input]);

  async function runTurn(text: string) {
    setError(null);
    addUser(text);
    resetAnswer();
    setActivity(null);
    setStatus("thinking");

    const result = await sendMessage(text, {
      onDelta: (delta) => {
        setActivity(null);
        setStatus("streaming");
        pushAnswer(delta);
      },
      onTool: setActivity,
      // 書き込みの記録は、その場で流れの中へ足す（#81）。サーバー側でも同じ内容を保存して
      // いるので、再読み込みしても同じ位置——秘書の返答より前——に残る。
      onRecord: addRecord,
      onError: setError,
    });

    // 途中で止めた場合も、そこまでの返答は残す。消えると何を聞いたかだけが残る。
    if (result.answer.trim() !== "") {
      addAssistant({ content: result.answer, interrupted: result.aborted });
    }

    resetAnswer();
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
    // 声の往復が走っていれば、それも割り込みの対象（#48）。畳んでから次へ入る。
    const previousVoiceTurn = voice.pendingTurn();
    abort();
    if (voiceOpen || previousVoiceTurn) closeVoice();

    const turn = (async () => {
      if (previousTurn) await previousTurn;
      if (previousVoiceTurn) await previousVoiceTurn;

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

  /**
   * 声で話し始める（#279）。
   *
   * **`prime()` は押された流れの中で、待たずに呼ぶ**——iOSは画面を触った流れで一度
   * `speak()` を通しておかないと、以降の読み上げが無音になる。走っている文字の往復が
   * あればそれに割り込み、そこまでの返答が並び終えてからマイクを開く（#48）。
   */
  function openVoice() {
    voice.prime();
    setVoiceOpen(true);

    /*
     * 記録の1行目に前提を残す（#205）。ホーム画面のPWAでしか出ない症状があるので、
     * どちらで開いたか・「マイクの接続を保つ」が入かで、貼られた記録の読み方が変わる。
     * 設定は `useVoiceSettings()` ではなく直接読む——ハイドレーションのあいだは既定値が返る。
     */
    const where = isStandalone() ? "ホーム画面のPWA" : "ブラウザのタブ";
    const hold = voiceSettingsSnapshot().holdMicOptIn ? "入" : "切";
    noteRecognition(`音声バーを開いた（${where}・接続を保つ:${hold}）`);

    const previousTurn = turnRef.current;
    abort();

    // 待つものが無い回は、押された流れのままマイクを開く（初回の許可の確認もそこで出る）。
    if (!previousTurn) {
      voice.beginListening();
      return;
    }

    void (async () => {
      await previousTurn;
      voice.beginListening();
    })();
  }

  /** 声をやめて入力欄へ戻す。読み上げもマイクも畳む。 */
  function closeVoice() {
    voice.stop();
    setVoiceOpen(false);
  }

  /** 生成を止める。文字と声のどちらの往復でも同じボタンから止まるようにする。 */
  function stopGenerating() {
    abort();
    voice.stop();
  }

  const overLimit = input.length > MAX_MESSAGE_LENGTH;
  /*
   * 生成中の表示は、文字の往復と声の往復で同じ1か所に出す（#279）。声の往復は返答が確定した
   * 時点で `answer` を空にしてあるので、**読み上げだけが続いている間は畳まれる**——畳まないと
   * 同じ文が記録の流れと生成中の欄に二重に並ぶ。
   */
  const busy = status !== "idle" || voice.status === "thinking" || (voice.answering && answer !== "");
  const thinking = answer === "" && (status === "thinking" || voice.status === "thinking");
  const currentActivity = activity ?? voice.activity;
  const isEmpty = entries.length === 0 && !busy && !voiceOpen;

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
              <p className="text-lg font-medium">今日はどんな一日でしたか。</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                思いついたことをそのまま書いてください。やり取りは1本の記録として続いていて、
                左の日付から読み返せます。
              </p>
            </div>
          )}

          {compactedCount > 0 && !isEmpty && <CompactedNote count={compactedCount} />}

          <EntryList entries={entries} todayKey={todayKey} />

          {busy && (
            <div className="flex gap-3">
              <SecretaryAvatar />
              <div className="min-w-0 flex-1">
                <SecretaryLabel />
                {thinking ? (
                  <p className="text-sm text-muted">
                    {currentActivity ? (
                      <>
                        {currentActivity.server}を調べています…
                        {currentActivity.tool !== "" && (
                          <span className="ml-1.5 text-[0.6875rem]">（{currentActivity.tool}）</span>
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
                  onClick={stopGenerating}
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
        {/*
          秘書の一言（#279）。お知らせ（#93）・ひとりごと（#101）・話題（#144）の輪を、
          「話す」画面の吹き出しと同じ輪から出す（問い合わせは声かけ `useNudges()` の1本を使い回す。
          同じ口を2本で叩かない）。**既定が「書く」になった以上、
          ここに出し先が無いとこの輪ごと——ニュースの仕入れの起点も含めて——動かなくなる。**
        */}
        <SecretaryLine payload={bubble} />

        {/*
          声で話している間は、入力欄のところが音声バーに入れ替わる（#279）。記録の流れは
          後ろにそのまま残るので、話した内容も返事も同じ並びへ積まれていく。**2つ並べない**
          ——スマホ（393×852）では入力欄と音声バーの両方を置くと、記録の見えるぶんが
          その高さだけ削られる。
        */}
        {voiceOpen ? (
          <VoiceBar voice={voice} onClose={closeVoice} />
        ) : (
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
                placeholder={busy ? "割り込んで話しかける" : "話しかける"}
                aria-label="相談したいこと"
                className="max-h-[200px] flex-1 resize-none bg-transparent py-1 text-sm outline-none placeholder:text-muted"
              />

              {/*
                応答中でも、書きかけがあるなら送信ボタンのまま出す（#48）。押すと生成を止めて
                そのまま送る。空のときだけ「止める」に入れ替える——書きかけを消してから止める、
                という順序を踏ませないため。
              */}
              {/*
                声で話し始める（#279）。**押した流れの中でマイクを開く**必要があるので、
                ここから `openVoice()` を直に呼ぶ。聞き取りに対応していない端末（Firefox等）
                では出さない——押しても開かないボタンを置くと、使えないことが分からない。
              */}
              {voice.supported && (
                <button
                  type="button"
                  onClick={openVoice}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground transition-colors hover:bg-rail-active"
                >
                  <Mic className="size-4" aria-hidden="true" />
                  <span className="sr-only">話しかける</span>
                </button>
              )}

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
                  : voice.supported
                    ? "Enter で送信 / Shift + Enter で改行 ・ マイクを押すと声で話せます"
                    : "Enter で送信 / Shift + Enter で改行"}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

