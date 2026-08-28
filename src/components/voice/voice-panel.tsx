"use client";

import { Keyboard, Mic, Play, Repeat, Settings2, Square, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTalkMode } from "@/components/chat/talk-mode-context";
import { ToolCallNote } from "@/components/chat/tool-call-note";
import type { ChatEntry, ChatToolCall } from "@/components/chat/types";
import { useChatStream } from "@/components/chat/use-chat-stream";
import {
  isSpeechRecognitionSupported,
  startRecognition,
  type RecognitionHandle,
} from "@/lib/speech/recognition";
import {
  RATE_MAX,
  RATE_MIN,
  type Reader,
  canSpeakWith,
  createReader,
  primeSpeechSynthesis,
  speakSample,
  watchJapaneseVoices,
} from "@/lib/speech/synthesis";
import {
  updateVoiceSettings,
  useRecognitionSupported,
  useVoiceSettings,
} from "@/lib/speech/voice-settings";
import {
  VOICEVOX_SPEAKERS,
  type EngineCheck,
  checkVoicevoxEngine,
  normalizeEngineUrl,
  parseVoicevoxSpeaker,
  primeVoicevoxAudio,
  voicevoxVoiceURI,
  warmVoicevoxSource,
} from "@/lib/speech/voicevox";
import { cn } from "@/lib/utils";

import { Robot, type RobotState } from "./robot";
import { SpeechBubble } from "./speech-bubble";
import { useNotice } from "./use-notice";

type Props = {
  /** 既存スレッドならそのID。新しい相談ならnull。 */
  conversationId: string | null;
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
};

/**
 * 何も聞き取れないまま閉じた聞き取りを、続けて開き直せる回数（#67）。
 *
 * Web Speech API の1回の聞き取りは、話し始めないまま数秒経つと `no-speech` で勝手に終わる。
 * 「続けて話す」で自動的に開いた直後は、返事を聞いてから話し出すまでにそれ以上かかるのが
 * 普通で、開き直さないと「待っています」へ戻ったまま声を拾わなくなる。1回あたり5〜8秒
 * なので、この回数でおよそ1分は開いたままに見える。
 */
const SILENT_RESTART_LIMIT = 10;

/**
 * 開き直すまでの間。
 *
 * `onend` の中からそのまま `start()` を呼ぶと、前の聞き取りが畳まれきっておらず弾かれる
 * 実装がある。少しだけ待ってから開き直す（弾かれた場合もこの間隔で試し直すので、
 * 短くしすぎると失敗が続いたときに素早く回りすぎる）。
 */
const RESTART_DELAY_MS = 300;

/**
 * 新しい相談で `/c/<ID>` へ移るまでの間（#67）。
 *
 * この移動はルートをまたぐためこの画面が作り直される。待機に入った直後に利用者が
 * マイクを押すことがあるので、少しだけ様子を見てから移る（押されたら取り消す）。
 */
const NAVIGATION_DELAY_MS = 600;

/**
 * 音声で秘書と対話する画面（#27）。
 *
 * 聞き取りも読み上げもブラウザ内蔵の Web Speech API で行い、返答の生成は「書く」と同じ
 * `POST /api/chat` を使う。声で話した内容も同じ相談スレッドへ残るため、「書く」に
 * 切り替えれば文字で読み返せる。
 *
 * ひと往復は idle → listening → thinking →（VOICEVOXの声なら preparing →）speaking → idle と
 * 進む。「続けて話す」が入なら最後の idle を挟まずに listening へ戻る。読み上げ中に
 * マイクを開かないのは、自分の声を聞き返して延々と往復し続けるのを防ぐため。
 *
 * 考えている・話している最中でも、マイクを押せばその場で割り込める（#48）。押した時点で
 * 読み上げを止めて生成を打ち切り、thinking / speaking → listening へ飛ぶ。マイクを開くのは
 * 黙らせた後なので、自分の声を拾わないという前提はそのまま保たれる。
 */
export function VoicePanel({ conversationId, initialEntries }: Props) {
  const { setMode } = useTalkMode();
  const { send: sendMessage, abort, flushNavigation } = useChatStream(conversationId);

  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [status, setStatus] = useState<RobotState>("idle");
  const [heard, setHeard] = useState("");
  const [lastUser, setLastUser] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  // 失敗ではないが伝えておきたいこと（VOICEVOXが使えず端末の声で読んだ、など）。
  const [notice, setNotice] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  // 外部サービスを見に行っている間の表示（#46）。声だけだと無言の数秒が長く感じる。
  const [activity, setActivity] = useState<{ server: string; tool: string } | null>(null);

  // 各アプリが積んだお知らせから、秘書が選んだ一言（#93）。待っている間だけ吹き出しに出る。
  // 変数名を `notice` にしないのは、上の `notice`（VOICEVOXが使えなかった等の案内）と別物のため。
  const bubbleNotice = useNotice();

  const settings = useVoiceSettings();
  const supported = useRecognitionSupported();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // 試し聞きの合成待ち。VOICEVOXは数秒かかるので、押しても無反応に見えないようにする（#52）。
  const [samplePreparing, setSamplePreparing] = useState(false);
  // 自前のVOICEVOX ENGINEへの疎通確認（#57）。
  const [engineCheck, setEngineCheck] = useState<EngineCheck | null>(null);
  const [engineChecking, setEngineChecking] = useState(false);

  const recognitionRef = useRef<RecognitionHandle | null>(null);
  const readerRef = useRef<Reader | null>(null);
  const sampleRef = useRef<Reader | null>(null);
  const finalRef = useRef("");
  // 走っている往復。割り込むときに、そこまでの返答が記録へ並び終えるのを待つ（#48）。
  const turnRef = useRef<Promise<void> | null>(null);
  const primedRef = useRef(false);
  const reactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 無音のまま閉じた聞き取りを開き直すための状態（#67）。
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRestartsRef = useRef(0);
  /** 利用者の操作で閉じた聞き取りは開き直さない。 */
  const closedByUserRef = useRef(false);
  /** 文言を出して終わった聞き取りは開き直さない（マイクが許可されていない、など）。 */
  const failedRef = useRef(false);

  // コールバックの中からは、その時点の最新の設定を見たい。stateを直接読むと
  // 聞き取りを始めた時点の値で固定される。
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 「読み上げ終わり → また聞き取り」と「聞き取り終わり → 送信」で互いを呼ぶため、
  // 実体はrefに置いて参照だけを渡す。
  const beginListeningRef = useRef<(resume?: boolean) => void>(() => {});
  const sendRef = useRef<(text: string) => void>(() => {});

  // 選べる声は端末が非同期に用意する。揃った時点で入れ直す。
  useEffect(() => watchJapaneseVoices(setVoices), []);

  const bump = useCallback(() => {
    setReacting(true);
    if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
    reactTimerRef.current = setTimeout(() => setReacting(false), 600);
  }, []);

  /** 開き直しの待ち合わせを取り消す。 */
  const clearRestartTimer = useCallback(() => {
    if (!restartTimerRef.current) return;
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = null;
  }, []);

  /** 動いているものを全部止める。画面を離れるときと、利用者が止めたとき。 */
  const stopEverything = useCallback(() => {
    // 開き直しの待ち合わせが残っていると、止めた直後にマイクが開き直す（#67）。
    closedByUserRef.current = true;
    clearRestartTimer();
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    readerRef.current?.cancel();
    readerRef.current = null;
    sampleRef.current?.cancel();
    sampleRef.current = null;
    setSamplePreparing(false);
    abort();
  }, [abort, clearRestartTimer]);

  useEffect(() => {
    return () => {
      if (reactTimerRef.current) clearTimeout(reactTimerRef.current);
      stopEverything();
    };
  }, [stopEverything]);

  const send = useCallback(
    async (text: string) => {
      setError(null);
      setNotice(null);
      setLastUser(text);
      setReply("");
      setActivity(null);
      setStatus("thinking");
      setEntries((previous) => [
        ...previous,
        { kind: "message", id: `local-user-${previous.length}`, role: "USER", content: text },
      ]);

      // 内蔵の声なら、届いた端から文の切れ目で読み上げる。全部揃うまで待つと、字幕が
      // 出ているのに声が始まらない時間ができる（VOICEVOXは仕組み上まとめて合成する）。
      const reader =
        settingsRef.current.speak && canSpeakWith(settingsRef.current.voiceURI)
          ? createReader({
              voiceURI: settingsRef.current.voiceURI,
              rate: settingsRef.current.rate,
              engineUrl: settingsRef.current.engineUrl,
              // VOICEVOXは合成に数秒かかる。「考えています」のままだと返事が来ていないように
              // 見え、マイクを押して割り込まれてしまう（#52）。
              onPreparing: () =>
                setStatus((current) => (current === "speaking" ? current : "preparing")),
              onStart: () => setStatus("speaking"),
              onDrain: () => {
                readerRef.current = null;
                if (settingsRef.current.continuous) beginListeningRef.current();
                else setStatus("idle");
              },
              onNotice: setNotice,
            })
          : null;
      readerRef.current = reader;

      let answer = "";

      const result = await sendMessage(text, {
        mode: "voice",
        // 送信が終わった後も読み上げと聞き取りが続く。`/c/<ID>` への移動でこの画面が
        // 作り直されると、そこまで巻き添えで畳まれる（#67）。
        deferNavigation: true,
        onDelta: (delta) => {
          answer += delta;
          setReply(answer);
          setActivity(null);
          reader?.push(delta);
        },
        onTool: setActivity,
        // 声だけでは「何を登録したのか」がその場で流れて消える。右の記録欄へ残す（#81）。
        onRecord: (call: ChatToolCall) => setEntries((previous) => [...previous, call]),
        onError: setError,
      });

      if (result.answer.trim() !== "") {
        setEntries((previous) => [
          ...previous,
          {
            kind: "message",
            id: `local-assistant-${previous.length}`,
            role: "ASSISTANT",
            content: result.answer,
            interrupted: result.aborted,
          },
        ]);
      }

      if (result.aborted) {
        // 利用者が止めた。読み上げも一緒に畳んで待機へ戻す。
        reader?.cancel();
        readerRef.current = null;
        setStatus("idle");
        return;
      }

      if (reader && !result.failed && result.answer.trim() !== "") {
        // ここから先は読み上げが終わるのを待つ。次の状態は onDrain が決める。
        reader.finish();
        return;
      }

      reader?.cancel();
      readerRef.current = null;
      // 失敗したときに聞き取りへ戻すと、同じ失敗を繰り返しかねない。待機で止める。
      if (!result.failed && settingsRef.current.continuous) beginListeningRef.current();
      else setStatus("idle");
    },
    [sendMessage],
  );

  useEffect(() => {
    sendRef.current = (text: string) => {
      const turn = send(text);
      turnRef.current = turn;
      void turn.finally(() => {
        if (turnRef.current === turn) turnRef.current = null;
      });
    };
  }, [send]);

  /**
   * 何も聞き取れないまま閉じた聞き取りを、少し待って開き直す（#67）。
   *
   * 1回の聞き取りは黙っていると数秒で勝手に終わる。ここで待機へ戻してしまうと、「続けて
   * 話す」で自動的に開いたマイクが、利用者が話し出す前に閉じたきりになる——画面は
   * 「待っています」のままで、話しかけても何も起きない。
   *
   * 開き直さないのは、利用者自身が閉じたとき・文言を出して失敗したとき（マイクが許可
   * されていない等。開き直しても同じところで失敗する）・回数を使い切ったとき。
   * 戻り値が false なら、呼ぶ側が待機へ戻す。
   */
  const retryListening = useCallback(() => {
    if (closedByUserRef.current || failedRef.current) return false;
    if (!isSpeechRecognitionSupported()) return false;
    if (silentRestartsRef.current >= SILENT_RESTART_LIMIT) return false;

    silentRestartsRef.current += 1;
    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      beginListeningRef.current(true);
    }, RESTART_DELAY_MS);

    return true;
  }, [clearRestartTimer]);

  /**
   * マイクを開く。`resume` は「無音で閉じたぶんを開き直している途中」という意味で、
   * このときだけ開き直しの回数を持ち越す（`false` なら数え直す）。
   */
  const beginListening = useCallback(
    (resume = false) => {
      if (recognitionRef.current) return;
      clearRestartTimer();

      if (!resume) silentRestartsRef.current = 0;
      closedByUserRef.current = false;
      failedRef.current = false;

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
        onSpeechStart: () => {
          // 声が届いた時点で開き直しの回数は仕切り直す。話し出すまでが長かっただけの
          // 往復で、次の番の待ち時間まで短くなっていくのを防ぐ。
          silentRestartsRef.current = 0;
          bump();
        },
        onError: (message) => {
          if (!message) return;
          failedRef.current = true;
          setError(message);
        },
        onEnd: () => {
          recognitionRef.current = null;
          setHeard("");

          const text = finalRef.current.trim();
          finalRef.current = "";

          if (text === "") {
            if (!retryListening()) setStatus("idle");
            return;
          }

          sendRef.current(text);
        },
      });

      if (!handle) {
        // 直前の聞き取りがまだ畳まれていないだけのことがある。少し待って開き直す。
        // 開き直しきっても始められないときだけ、理由が分かるように文言を出す。
        if (!retryListening()) {
          setError("聞き取りを開始できませんでした。少し待ってからもう一度お試しください。");
          setStatus("idle");
        }
        return;
      }

      recognitionRef.current = handle;
    },
    [bump, clearRestartTimer, retryListening],
  );

  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  /**
   * 新しい相談で遅らせておいた `/c/<ID>` への移動を、待機に入ってから行う（#67）。
   *
   * この移動はルートをまたぐのでこの画面は作り直される。往復の途中で起きると、読み上げも
   * 「続けて話す」で開いたマイクも一緒に畳まれ、話しかけても何も起きなくなる。待機は
   * 「失うものが無い」唯一の時点なので、そこまで待つ。待機に入った直後にマイクを押された
   * 場合は `status` が変わって取り消される。
   */
  useEffect(() => {
    if (status !== "idle") return;

    const timer = setTimeout(flushNavigation, NAVIGATION_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, flushNavigation]);

  /** iOSは「画面を触った流れ」で一度鳴らしておかないと、以降が無音になる。 */
  function prime() {
    // ENGINEが届くかは先に調べておく。返答が届いてから調べると、届かない端末では
    // 最初のひと声がそのぶん遅れる（#57）。
    warmVoicevoxSource(settingsRef.current.engineUrl);

    if (primedRef.current) return;
    primeSpeechSynthesis();
    primeVoicevoxAudio();
    primedRef.current = true;
  }

  /** 選んでいる声で1文だけ鳴らす。押した操作をiOSの許可としても使う。 */
  function onSample() {
    prime();
    setNotice(null);
    sampleRef.current?.cancel();
    setSamplePreparing(false);
    sampleRef.current = speakSample(settings.voiceURI, settings.rate, {
      engineUrl: settings.engineUrl,
      onPreparing: () => setSamplePreparing(true),
      onDone: () => setSamplePreparing(false),
      onNotice: setNotice,
    });
  }

  /** 入力したENGINEのURLへ実際に届くかを確かめる。 */
  async function onCheckEngine() {
    setEngineChecking(true);
    setEngineCheck(await checkVoicevoxEngine(settings.engineUrl));
    setEngineChecking(false);
  }

  /** 返答も読み上げも畳んで待機へ戻す。もう聞かなくてよくなったとき。 */
  function stopNow() {
    stopEverything();
    setStatus("idle");
  }

  /**
   * 返答の途中で割り込んでそのまま話し始める（#48）。
   *
   * 読み上げを止めて生成を打ち切り、そこまでの返答が記録へ並ぶのを待ってから聞き取りへ入る。
   * 待たずに開くと、打ち切られた往復の後片付けが `idle` を書き込み、開いたばかりの
   * 「聞いています」を上書きしてしまう。
   *
   * 読み上げ中もマイクを開きっぱなしにする常時バージインは採らない。自分の声を聞き返して
   * 往復が止まらなくなるため、割り込みは「押した瞬間に黙る」形にしている。
   */
  function interruptAndListen() {
    const previousTurn = turnRef.current;

    readerRef.current?.cancel();
    readerRef.current = null;
    abort();

    void (async () => {
      if (previousTurn) await previousTurn;
      beginListening();
    })();
  }

  /** 中央の大きなボタン。いまの状態によって役割が入れ替わる。 */
  function onPrimaryButton() {
    prime();
    sampleRef.current?.cancel();
    sampleRef.current = null;
    setSamplePreparing(false);

    if (status === "listening") {
      // 聞き取り中は「話し終わった」の合図。確定して送信へ進む。
      closedByUserRef.current = true;
      clearRestartTimer();

      // 開き直す合間（マイクが閉じている数百ミリ秒）に押されることがある。そこで
      // 何もしないと、押したのに開き直してしまう（#67）。
      if (recognitionRef.current) recognitionRef.current.stop();
      else setStatus("idle");
      return;
    }

    if (status === "thinking" || status === "preparing" || status === "speaking") {
      interruptAndListen();
      return;
    }

    beginListening();
  }

  const answering = status === "thinking" || status === "preparing" || status === "speaking";
  const primaryLabel =
    status === "listening" ? "話し終わった" : answering ? "割り込んで話す" : "話しかける";
  const speakable = canSpeakWith(settings.voiceURI);
  const voicevoxSpeaker = parseVoicevoxSpeaker(settings.voiceURI);
  const engineConfigured = normalizeEngineUrl(settings.engineUrl) !== null;

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
                onChange={(event) => {
                  sampleRef.current?.cancel();
                  sampleRef.current = null;
                  setSamplePreparing(false);
                  setNotice(null);
                  updateVoiceSettings({ voiceURI: event.target.value || null });
                }}
                className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-accent"
              >
                <option value="">端末におまかせ</option>
                <optgroup label="VOICEVOX（インターネット経由）">
                  {VOICEVOX_SPEAKERS.map((speaker) => (
                    <option key={speaker.id} value={voicevoxVoiceURI(speaker.id)}>
                      {speaker.label}
                    </option>
                  ))}
                </optgroup>
                {voices.length > 0 && (
                  <optgroup label="この端末の声">
                    {voices.map((voice) => (
                      <option key={voice.voiceURI} value={voice.voiceURI}>
                        {voice.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <button
              type="button"
              onClick={onSample}
              disabled={!speakable || samplePreparing}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-sm transition-colors hover:bg-rail-active disabled:opacity-40"
            >
              <Play className="size-3.5" aria-hidden="true" />
              {samplePreparing ? "声を用意しています…" : "試し聞き"}
            </button>

            {voicevoxSpeaker && (
              <>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  {voicevoxSpeaker.credit}
                  <br />
                  {engineConfigured
                    ? "下のVOICEVOX ENGINEで合成します。届かないときだけ、返事の文面がWEB版API（api.tts.quest）へ送られ、それも駄目ならこの端末の声で読み上げます。"
                    : "返事の文面は、音声にするためVOICEVOXのWEB版API（api.tts.quest）へ送られます。合成に数秒かかるため、返事が出てから声が始まるまで少し間があきます。混み合っているときや通信できないときは、この端末の声で読み上げます。"}
                </p>

                <label className="flex flex-col gap-1.5 py-2 text-sm">
                  VOICEVOX ENGINE のURL
                  <input
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://<ホスト名>:50021"
                    value={settings.engineUrl}
                    onChange={(event) => {
                      setEngineCheck(null);
                      updateVoiceSettings({ engineUrl: event.target.value });
                    }}
                    className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-xs leading-relaxed text-muted">
                    自分で動かしているENGINEがあれば入れてください。合成が速くなり、返事の文面が
                    外へ出なくなります。この端末にだけ保存されます。
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => void onCheckEngine()}
                  disabled={!engineConfigured || engineChecking}
                  className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm transition-colors hover:bg-rail-active disabled:opacity-40"
                >
                  {engineChecking ? "確かめています…" : "接続を確かめる"}
                </button>

                {engineCheck && (
                  <p className="mt-2 text-xs leading-relaxed text-muted">
                    {engineCheck.ok
                      ? `つながりました（ENGINE ${engineCheck.version}）。`
                      : engineCheck.message}
                  </p>
                )}
              </>
            )}

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
                このブラウザは端末の声での読み上げに対応していません。VOICEVOXの声を選ぶと読み上げられます。
              </p>
            )}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-6 text-center">
          {/* 待っている間は積まれたお知らせを、往復中はいまの状態を、同じ吹き出しで出す
              （#93）。外部サービスを見に行っている間に理由を出す扱い（#46）もここへ移した。 */}
          <SpeechBubble state={status} notice={bubbleNotice} activity={activity} />

          <Robot
            state={status}
            reacting={reacting}
            className="size-[168px] md:size-[184px] lg:size-[200px]"
          />

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
                    <span className="text-muted">
                      {activity ? `${activity.server}を調べています…` : "返事を考えています…"}
                    </span>
                  ) : entries.length === 0 ? (
                    <span className="text-muted">
                      下のマイクを押して、そのまま話しかけてください。
                    </span>
                  ) : (
                    <span className="text-muted">続けて話しかけてください。</span>
                  )}
                </p>
              </>
            )}

            {answering && (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={stopNow}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-rail-active"
                >
                  <Square className="size-2.5 fill-current" aria-hidden="true" />
                  {status === "thinking" ? "生成を止める" : "読み上げを止める"}
                </button>
                <p className="text-[0.6875rem] text-muted">
                  下のマイクを押すと、途中で割り込んで話しかけられます。
                </p>
              </div>
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

            {notice && (
              <p className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
                {notice}
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

          {/*
            応答中もマイクのまま出す（#48）。押すと読み上げを止めて、そのまま聞き取りへ入る。
            四角に変えるのは聞き取り中だけ——そこでの役割は「話し終わった」の合図のため。
          */}
          <button
            type="button"
            onClick={onPrimaryButton}
            disabled={!supported && status !== "listening"}
            className={cn(
              "grid size-[76px] place-items-center rounded-full transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40",
              status === "listening"
                ? "border border-border bg-surface text-foreground"
                : "bg-accent text-accent-foreground shadow-[0_0_0_8px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
            )}
          >
            {status === "listening" ? (
              <Square className="size-6 fill-current" aria-hidden="true" />
            ) : (
              <Mic className="size-7" aria-hidden="true" />
            )}
            <span className="sr-only">{primaryLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopEverything();
              // 遅らせていた移動をここで消化する。`/` のままだと「書く」が新しい相談として
              // 開き、いま話した内容が消えたように見える（#67）。
              flushNavigation();
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
          {entries.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted">
              話しかけると、ここにやり取りが残ります。
            </p>
          ) : (
            entries.map((entry) =>
              entry.kind === "tool" ? (
                <ToolCallNote key={entry.id} call={entry} compact />
              ) : (
                <div key={entry.id} className="flex flex-col gap-1">
                  <span className="text-[0.625rem] font-bold tracking-[0.08em] text-muted">
                    {entry.role === "USER" ? "わたし" : "秘書"}
                  </span>
                  <p
                    className={cn(
                      "whitespace-pre-wrap break-words text-xs leading-relaxed",
                      entry.role === "USER" &&
                        "rounded-[10px_10px_10px_3px] bg-accent-surface px-2.5 py-1.5",
                    )}
                  >
                    {entry.content}
                  </p>
                  {entry.interrupted && (
                    <p className="text-[0.625rem] text-muted">— ここで割り込みました</p>
                  )}
                </div>
              ),
            )
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
