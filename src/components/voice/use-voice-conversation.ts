"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatToolCall } from "@/components/chat/types";
import { useChatStream } from "@/components/chat/use-chat-stream";
import { holdMicStream, isMicStreamHeld, releaseMicStream } from "@/lib/speech/mic-stream";
import {
  isSpeechRecognitionSupported,
  noteRecognition,
  RECOGNITION_ABORTED,
  resetRecognition,
  startRecognition,
  type RecognitionHandle,
} from "@/lib/speech/recognition";
import {
  type Reader,
  canSpeakWith,
  createReader,
  primeSpeechSynthesis,
  silenceBeforeListening,
} from "@/lib/speech/synthesis";
import { useRecognitionSupported, useVoiceSettings } from "@/lib/speech/voice-settings";
import {
  parseVoicevoxSpeaker,
  primeVoicevoxAudio,
  warmVoicevoxSource,
} from "@/lib/speech/voicevox";

import type { RobotState } from "./robot";

/**
 * 声で秘書と話すひと往復（#27）。**聞き取り・送信・読み上げ・開き直しの実装はここ1か所。**
 *
 * #279で `voice-panel.tsx` から切り出した。「話す」の全画面（ロボット）と、「書く」画面の下に
 * 出る音声バー（`@/components/chat/voice-bar`）が同じこのフックを使う。**2つに分かれると、
 * iOSの実機でしか出ない不具合（#155・#164・#179・#197・#205・#210）の手当てが片方にだけ
 * 入った状態が必ず生まれる**——このファイルの注記はどれも、そうやって実機の記録から1つずつ
 * 積み上げたもので、順序を入れ替えると「1往復目だけ通る」へ戻る。
 *
 * ひと往復は idle → listening → thinking →（VOICEVOXの声なら preparing →）speaking → idle と
 * 進む。「続けて話す」が入なら最後の idle を挟まずに listening へ戻る。読み上げ中にマイクを
 * 開かないのは、自分の声を聞き返して延々と往復し続けるのを防ぐため。
 *
 * **画面への反映（発言を並べる・返答を出す）は持たない。** 呼ぶ側のコールバックへ渡すだけで、
 * 「話す」は吹き出しと記録欄へ、「書く」は記録の流れへ足す。
 */

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
 * 返答を読み終えてから、マイクを開くまでの間（#164）。
 *
 * iOSでは読み上げが終わっても音声の扱いが「再生中」のまま居座ることがあり、間を置かずに
 * 開いたマイクへ音が回ってこない——iPhoneのPWAで「1往復目だけ通り、続けて話しても
 * 認識されない」の、いちばん疑わしい形。手放し（`silenceBeforeListening()`）だけでは
 * 切り替えが間に合わないことがあるので、わずかに待ってから開く。
 */
const RESUME_AFTER_SPEECH_MS = 400;

/**
 * 何も聞こえないまま閉じた回が続いたときに、案内を出し始める回数（#164）。
 *
 * **開き直しそのものは今までどおり `SILENT_RESTART_LIMIT` 回まで続ける**——返事を聞いてから
 * 話し出すまでに時間がかかる往復（#67）で、マイクが早く閉じるようになっては元も子もない。
 * 「まだ聞き取れていない」と伝えるだけにして、待つのはやめない。
 *
 * **ここで聞き取りの実体を作り直してはいけない。** 報告された症状では開き直しのたびに
 * この条件が真になるため、実質「毎回作り直す」になり、#155が名指しで潰した振る舞いへ
 * 丸ごと戻る。作り直すのは `onend` すら返らなくなったときだけ（`LISTEN_WATCHDOG_MS`）。
 */
const SILENT_HINT_AFTER = 2;

/**
 * 開いた聞き取りが黙り込んだと見なすまでの間（#164）。
 *
 * **`onend` が返ってこない場合に備えた唯一の逃げ道。** 開き直し（#67）も案内も
 * `onEnd` の中からしか動かないので、実体が開いたまま死ぬと**どれも一度も評価されない**
 * ——画面は「お話しください…」のまま無反応になり、「話し終わった」を押しても
 * `stop()` が何も起こさず、待機へ戻る手段がなくなる（#164の報告と同じ見え方）。
 *
 * 声が届く・文字が届くたびに数え直すので、これは「何の音沙汰も無いまま経った時間」。
 * 1回の聞き取りは黙っていれば5〜8秒で `no-speech` を返して閉じるため、そこまで待てば
 * ふつうの往復には掛からない。
 */
const LISTEN_WATCHDOG_MS = 15_000;

/**
 * 「話し終わった」を押してから、`onend` を待つ間（#164）。
 *
 * 実体が死んでいると `stop()` を呼んでも何も返らない。押したのに画面が変わらないまま
 * 取り残されるので、返らなければこちらで畳む。聞き取れていた文はそのまま送る。
 */
const STOP_WATCHDOG_MS = 2_000;

/**
 * 何も聞き取れないまま開き直しが続いているときに出す案内（#155・#164）。
 *
 * `no-speech` は文言を出さない扱い（#67）なので、出さなければ画面は「お話しください…」
 * または「続けて話しかけてください。」のまま1分近く変わらない。マイクが開いているつもりで
 * 話し続けている利用者からは、話しても何も起きない画面にしか見えない。
 */
export const SILENT_CLOSE_HINT =
  "聞き取れていないようです。マイクを押し直してから話しかけてください。";

/**
 * 端末が聞き取りを打ち切ったあと、開き直すまでの間（#197）。
 *
 * 何も聞こえずに閉じた回（`RESTART_DELAY_MS`）より長く待つ。中断は端末側の都合で起きて
 * おり、`onend` の直後に開き直しても同じところで打ち切られる——実際、報告された記録では
 * 300msで開き直した回が続けて `aborted` になっている。
 */
const ABORTED_RESTART_DELAY_MS = 1_000;

/**
 * 端末による中断（`aborted`）を、続けて何回まで開き直すか（#197）。
 *
 * 1回目は聞き取りの実体を作り直して開き直す。**2回続いたらやめる**——同じ理由で打ち切られて
 * いるので、待っても直らない。`retryListening()` に任せると `SILENT_RESTART_LIMIT`（10回）を
 * 300msごとに使い切ることになり、そのあいだ画面は「お話しください…」のまま変わらない。
 */
const ABORTED_RESTART_LIMIT = 1;

/**
 * 画面を開いてから、端末の中断を理由に実体を作り直してよい回数（#197）。
 *
 * **上限は往復単位ではなくマウント単位で持つ。** 利用者がマイクを押し直すたびに数え直すと、
 * 押すたびに1回ずつ作り直すことになり、#155が名指しで潰した「実質毎回作り直す」に近づく。
 * 使い切ったら作り直さずに開き直すだけにする——案内は変わらず出るので、画面が止まったまま
 * にはならない。
 */
const ABORTED_RESET_LIMIT = 3;

/**
 * 端末による中断が続いたときに出す案内（#197）。
 *
 * **`SILENT_CLOSE_HINT` では合わない場面のために足したもの。** あちらは「マイクを押し直して
 * から話しかけてください」＝押し直せば直る前提の文言だが、端末に中断されているときは
 * **押し直しても同じところで打ち切られる**（#197の記録では、手で押し直した回も `aborted`）。
 * iPhoneのホーム画面PWAでだけ起きており、同じ端末でもSafariのタブでは続けて話せる
 * （#179の切り分け）ので、その場でできる回避策まで書く。
 */
const ABORTED_HINT =
  "端末が聞き取りを中断しました。アプリをいったん閉じて開き直すか、Safariのタブで開いてお試しください。";

/**
 * 聞き取りを開いた理由（#205）。記録の「マイクを開いた」に括弧で添える。
 *
 * **同じ「マイクを開いた」でも、押して開いた回と自動で開いた回では前提がまるで違う。**
 * 押した回は利用者の操作の流れの中（`prime()` を通っており、端末から見ても操作の直後）で、
 * 自動で開いた回はその外。#205で報告された記録では中断されたのは自動で開いた回だけだったが、
 * 行だけを見てもそれが読み取れなかった。
 */
const LISTEN_REASON = {
  pressed: "押した",
  afterSpeech: "読み上げのあと",
  interrupt: "割り込み",
  silentRetry: "開き直し",
  afterAbort: "中断のあと",
} as const;

type ListenReason = (typeof LISTEN_REASON)[keyof typeof LISTEN_REASON];

/**
 * ホーム画面のPWA（standalone）として開いているか（#205）。
 *
 * iOSのSafariは `display-mode: standalone` を返さない世代があるため、非標準の
 * `navigator.standalone`（型は標準libに無い）も見る。
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia("(display-mode: standalone)").matches;
}

/** 繋いだ外部サービスを見に行っている間の表示（#46）。 */
export type VoiceActivity = { server: string; tool: string };

export type VoiceConversationCallbacks = {
  /**
   * 聞き取った発言を送ったとき。画面の流れへ足す。
   *
   * 返答（`onReply`）はこの後から届くので、呼ぶ側はここで前の返答を消してよい。
   */
  onUserMessage: (text: string) => void;
  /** 生成中の返答。届いた差分ではなく、そこまでの全文を渡す。 */
  onReply: (text: string) => void;
  /** 書き込みの道具の記録（#81）。 */
  onRecord: (call: ChatToolCall) => void;
  /** 返答が確定したとき。1文字も返らなかった往復では呼ばない。 */
  onAssistantMessage: (message: { content: string; interrupted: boolean }) => void;
};

export type VoiceConversation = {
  status: RobotState;
  /** 聞き取っている途中の文字。確定していないので記録には残さない。 */
  heard: string;
  /** 聞き取りの側の案内（#155）。読み上げの側（`notice`）と混ぜない。 */
  hint: string | null;
  /** 失敗ではないが伝えておきたいこと（VOICEVOXが使えず端末の声で読んだ、など）。 */
  notice: string | null;
  error: string | null;
  activity: VoiceActivity | null;
  /** 声が届いた合図。ロボットの小さな反応に使う。 */
  reacting: boolean;
  /** 聞き取りは開いているのに、何も聞こえないまま開き直しが続いている（#164）。 */
  stalled: boolean;
  /** 返事を作っている・読み上げている最中。割り込みの対象（#48）。 */
  answering: boolean;
  /** 中央のボタンを「話し終わった」（四角）として出すか。 */
  showStop: boolean;
  /** 中央のボタンの名前。読み上げソフトへはこれを渡す。 */
  primaryLabel: string;
  /**
   * 読み上げの側の案内（`notice`）を書き換える。
   *
   * 声の設定の「試し聞き」も同じ欄へ出すため、往復の外からも触れるようにしてある
   * （出す場所を分けると、片方を出したときにもう片方が消えない＝2つ並ぶ）。
   */
  setNotice: (value: string | null) => void;
  /** この端末で聞き取りが使えるか。 */
  supported: boolean;
  /**
   * iOSの許可取り。**利用者が押した流れの中で、待たずに呼ぶこと。**
   *
   * 一度 `speak()` を通しておかないと以降の読み上げが無音になる。`await` を挟んでから
   * 呼ぶと操作の流れから外れて効かない。
   */
  prime: () => void;
  /** 中央のボタン。いまの状態によって役割が入れ替わる。 */
  pressPrimary: () => void;
  /** マイクを開く。開いているものがあれば畳んでから開き直す。 */
  beginListening: () => void;
  /** 返答も読み上げも畳んで待機へ戻す。もう聞かなくてよくなったとき。 */
  stop: () => void;
  /**
   * 走っている往復（#48）。
   *
   * 割り込む側は、そこまでの返答が並び終えるのを待ってから次の発言を足す。待たずに足すと、
   * 遮られた返答が自分の次の発言より下に出る。
   */
  pendingTurn: () => Promise<void> | null;
};

export function useVoiceConversation(
  callbacks: VoiceConversationCallbacks,
): VoiceConversation {
  const { send: sendMessage, abort } = useChatStream();

  const [status, setStatus] = useState<RobotState>("idle");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [reacting, setReacting] = useState(false);
  const [activity, setActivity] = useState<VoiceActivity | null>(null);

  const settings = useVoiceSettings();
  const supported = useRecognitionSupported();

  // 描画のたびに作り直される呼ぶ側の関数で、聞き取りの組み立てまで作り直さない。
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  const recognitionRef = useRef<RecognitionHandle | null>(null);
  /**
   * 聞き取りの世代（#155）。
   *
   * 畳んだ聞き取りから遅れて届いたイベントで、開いたばかりの聞き取りを壊さないための印。
   * `onend` が返ってこない実装（iOSで実際に起きる）でも、押し直せば必ず新しい世代で開き直せる。
   */
  const recognitionSessionRef = useRef(0);
  const readerRef = useRef<Reader | null>(null);
  const finalRef = useRef("");
  // 走っている往復。割り込むときに、そこまでの返答が記録へ並び終えるのを待つ（#48）。
  const turnRef = useRef<Promise<void> | null>(null);
  const primedRef = useRef(false);
  const reactTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 無音のまま閉じた聞き取りを開き直すための状態（#67）。
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRestartsRef = useRef(0);
  // 開いたまま黙り込んだ聞き取りを見張る（#164）。`onend` に頼らない唯一の経路。
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** いま開いている聞き取りを畳む手。見張りと「話し終わった」から呼ぶ（#164）。 */
  const finishTurnRef = useRef<(stuck: boolean) => void>(() => {});
  /** 利用者の操作で閉じた聞き取りは開き直さない。 */
  const closedByUserRef = useRef(false);
  /** 文言を出して終わった聞き取りは開き直さない（マイクが許可されていない、など）。 */
  const failedRef = useRef(false);
  /**
   * 端末に中断された（`aborted`）回が続いている数（#197）。
   *
   * 何も聞こえずに閉じた回（`silentRestartsRef`）と分けて数える。前者は待てば話し出せる
   * ——実際に声が届く往復がある——のに対し、こちらは同じところで打ち切られ続けるので、
   * 早めにやめて理由を画面へ出す必要がある。
   */
  const abortedRef = useRef(0);
  /**
   * 画面を開いてから、中断を理由に実体を作り直した回数（#197）。**往復をまたいで数える。**
   *
   * 利用者が押し直すたびに数え直すと、押すたびに1回ずつ作り直すことになり、#155が潰した
   * 「実質毎回作り直す」へ近づく。`beginListening()` では戻さない。
   */
  const abortedResetsRef = useRef(0);

  // コールバックの中からは、その時点の最新の設定を見たい。stateを直接読むと
  // 聞き取りを始めた時点の値で固定される。
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // 「読み上げ終わり → また聞き取り」と「聞き取り終わり → 送信」で互いを呼ぶため、
  // 実体はrefに置いて参照だけを渡す。
  const beginListeningRef = useRef<(resume?: boolean, reason?: ListenReason) => void>(() => {});
  const resumeAfterSpeakingRef = useRef<() => void>(() => {});
  const sendRef = useRef<(text: string) => void>(() => {});

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

  /** 見張りを解く（#164）。 */
  const clearWatchdog = useCallback(() => {
    if (!watchdogRef.current) return;
    clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  /**
   * 見張りを掛け直す（#164）。声や文字が届くたびに数え直すので、掛け直しで上書きする。
   */
  const armWatchdog = useCallback(
    (ms: number) => {
      clearWatchdog();
      watchdogRef.current = setTimeout(() => {
        watchdogRef.current = null;
        finishTurnRef.current(true);
      }, ms);
    },
    [clearWatchdog],
  );

  /**
   * 走っている聞き取りを捨てる（#155）。
   *
   * **`recognitionRef` を持っているだけで何もしない、をやめるための関数。** 以前は
   * `beginListening()` の先頭で「すでに持っていたら何もせず戻る」としていたが、
   * **`onend` が返らない実装ではこの参照が居座り、以後どれだけマイクを押しても
   * 黙って戻るだけになる**（画面は「続けて話しかけてください。」のまま変わらない）。
   * 捨てたぶんから遅れて届くイベントは、世代の印で落とす。
   */
  const discardRecognition = useCallback(() => {
    recognitionSessionRef.current += 1;
    clearWatchdog();

    const handle = recognitionRef.current;
    recognitionRef.current = null;
    handle?.abort();
  }, [clearWatchdog]);

  /** 動いているものを全部止める。画面を離れるときと、利用者が止めたとき。 */
  const stopEverything = useCallback(() => {
    // 開き直しの待ち合わせが残っていると、止めた直後にマイクが開き直す（#67）。
    closedByUserRef.current = true;
    clearRestartTimer();
    discardRecognition();
    readerRef.current?.cancel();
    readerRef.current = null;
    // 掴んだままのマイクを離す（#179）。もう聞かなくてよくなった合図なので、録音中の印を
    // 出したままにしない。次にマイクを押せば、その操作の流れで取り直す。
    releaseMicStream();
    abort();
  }, [abort, clearRestartTimer, discardRecognition]);

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
      setHint(null);
      setActivity(null);
      setStatus("thinking");
      callbacksRef.current.onUserMessage(text);

      /*
       * 読み上げの始まり・終わりも記録に残す（#210）。iPhoneのPWAで壊れるのは読み上げの
       * あとに開いた聞き取りなので、読み上げが何で・いつ終わり、そこから何ミリ秒後に
       * マイクを開いたのかが記録から読めないと切り分けにならない。VOICEVOXが端末の声へ
       * 落ちた回は `onStart` が2度来うる（落ちた先の `SpeechReader` にも同じものを渡す）
       * ので、1往復につき1行にする。
       */
      const voiceKind = parseVoicevoxSpeaker(settingsRef.current.voiceURI) ? "VOICEVOX" : "端末の声";
      let speechNoted = false;

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
              onStart: () => {
                if (!speechNoted) {
                  speechNoted = true;
                  noteRecognition(`読み上げを始めた（${voiceKind}）`);
                }
                setStatus("speaking");
              },
              onDrain: () => {
                noteRecognition("読み上げを終えた");
                readerRef.current = null;
                // 読み終えた直後に開くと、iOSでは声が届かないことがある（#164）。
                if (settingsRef.current.continuous) resumeAfterSpeakingRef.current();
                else setStatus("idle");
              },
              onNotice: setNotice,
            })
          : null;
      readerRef.current = reader;

      let answer = "";

      const result = await sendMessage(text, {
        mode: "voice",
        onDelta: (delta) => {
          answer += delta;
          callbacksRef.current.onReply(answer);
          setActivity(null);
          reader?.push(delta);
        },
        onTool: setActivity,
        // 声だけでは「何を登録したのか」がその場で流れて消える。記録として残す（#81）。
        onRecord: (call: ChatToolCall) => callbacksRef.current.onRecord(call),
        onError: setError,
      });

      if (result.answer.trim() !== "") {
        callbacksRef.current.onAssistantMessage({
          content: result.answer,
          interrupted: result.aborted,
        });
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
      if (!result.failed && settingsRef.current.continuous) resumeAfterSpeakingRef.current();
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

    /*
     * 何も聞こえない回が続いたら案内を出す（#164）。開き直しは続けるので画面は
     * 「お話しください…」のままだが、聞き取れていないことだけは伝わる——出さないと、
     * 話しても何も起きない画面が1分近く続く。
     *
     * **ここで実体を作り直さないこと。** この条件は報告された症状では毎回真になるため、
     * 作り直すと#155で潰した振る舞いへ丸ごと戻る（`resetRecognition()` の注記を参照）。
     */
    if (silentRestartsRef.current >= SILENT_HINT_AFTER) setHint(SILENT_CLOSE_HINT);

    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      beginListeningRef.current(true, LISTEN_REASON.silentRetry);
    }, RESTART_DELAY_MS);

    return true;
  }, [clearRestartTimer]);

  /**
   * 端末に中断された聞き取りを、実体を作り直してから開き直す（#197）。
   *
   * `retryListening()` と分けてあるのは、**待ち時間も回数も止めどきも別物**のため。無音で
   * 閉じた回は話し出すまでの間を待つのが目的で何度でも開き直してよいが、中断は端末側の
   * 都合なので、同じ実体・同じ間合いで開き直しても打ち切られ続ける。
   *
   * **実体を作り直してよい場面はここと、`onend` すら返らなくなった回（`finishTurn(true)`）の
   * 2つだけ。** #155が禁じたのは「何も聞こえないまま閉じた回で作り直す」ことで、それは
   * 毎回真になるため実質「毎回作り直す」になってしまうという理由だった。中断は続けて2回で
   * 打ち切るので、その形にはならない。
   *
   * 戻り値が false なら、呼ぶ側が案内を出して待機へ戻す。
   */
  const restartAfterAbort = useCallback(() => {
    if (closedByUserRef.current || failedRef.current) return false;
    if (!isSpeechRecognitionSupported()) return false;
    if (abortedRef.current > ABORTED_RESTART_LIMIT) return false;

    /*
     * 掴んだままのマイクの接続を手放してから開き直す（#205）。
     *
     * #205で報告された記録では、**中断された往復は接続を保ったまま**だった（保ったのは
     * その前に押した回で、以後どこも手放していない）。#197が疑った「掴んだ接続と聞き取りが
     * 取り合っている」と整合するので、中断されたときだけは手放して試す——というのが#205の
     * 手当てで、**#210からは開く前に必ず手放す**（`beginListening()`）ので、ここで手放すのは
     * 開き直しまでの1秒の間を空けるためだけになった。設定（`holdMicOptIn`）が切なら何も起きない。
     */
    releaseMicStream();

    // 作り直しはマウント単位で打ち止めにする。使い切っても開き直しはする——ここで戻すと、
    // 押し直しても待機のままで、利用者からは何も起きていないように見える。
    if (abortedResetsRef.current < ABORTED_RESET_LIMIT) {
      abortedResetsRef.current += 1;
      resetRecognition();
    }

    clearRestartTimer();
    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      beginListeningRef.current(true, LISTEN_REASON.afterAbort);
    }, ABORTED_RESTART_DELAY_MS);

    return true;
  }, [clearRestartTimer]);

  /**
   * マイクを開く。`resume` は「無音で閉じたぶんを開き直している途中」という意味で、
   * このときだけ開き直しの回数を持ち越す（`false` なら数え直す）。
   */
  const beginListening = useCallback(
    (resume = false, reason: ListenReason = LISTEN_REASON.pressed) => {
      clearRestartTimer();
      /*
       * 保っているマイクの接続は、開く前に必ず手放す（#210）。
       *
       * #205・#210の実機の記録を合わせると、**開いた時点で接続をすでに保っていた聞き取りは
       * 5回とも声が届かず**（`aborted`・黙ったまま15秒・`audio-capture`）、**開いた後に接続を
       * 取った聞き取りは3回とも届いた**（どれも1往復目で、`start()` の後に `getUserMedia` が
       * 返っている）。「保つ」設定が入なら、下で `start()` が通ってから取り直す。切なら何も
       * 保っていないので、この呼び出しは何もしない。
       */
      releaseMicStream();
      // 走っているものがあれば畳んでから開き直す。持っているだけで戻ると、`onend` が
      // 返らなかった1回のせいでマイクが二度と開かなくなる（#155）。
      discardRecognition();
      const session = recognitionSessionRef.current;

      if (!resume) {
        silentRestartsRef.current = 0;
        abortedRef.current = 0;
        // 開き直しの途中では消さない（#164）。出したそばから次の開き直しが消してしまい、
        // 「聞き取れていないようです」が一度も読めないまま点滅する。
        setHint(null);
      }
      closedByUserRef.current = false;
      failedRef.current = false;

      setError(null);
      setHeard("");
      finalRef.current = "";
      setStatus("listening");

      /** この世代の聞き取りからのイベントか。畳んだぶんから遅れて届いたものは捨てる。 */
      const current = () => recognitionSessionRef.current === session;

      /** この回はもう畳んだか。`onend` と見張りの両方から呼ばれるので、二重に畳まない。 */
      let settled = false;

      /**
       * 1回の聞き取りを畳む（#164）。
       *
       * `stuck` は「`onend` が返ってこないまま見張りに掛かった」という意味。実体を作り直して
       * よいのはこの経路と、端末に中断された回（`restartAfterAbort()`。#197）だけ——
       * `no-speech` で正しく閉じているうちは実体は生きており、そこで作り直すと#155で潰した
       * 振る舞いへ戻る。
       */
      const finishTurn = (stuck: boolean) => {
        if (!current() || settled) return;
        settled = true;
        clearWatchdog();

        if (stuck) {
          // 開いたきり黙り込んだ。実体が死んでいると見て捨てる。
          discardRecognition();
          resetRecognition();
        } else {
          recognitionRef.current = null;
        }

        setHeard("");

        const text = finalRef.current.trim();
        finalRef.current = "";

        if (text === "") {
          /*
           * 端末に中断された回は、無音で閉じた回とは別に扱う（#197）。作り直して1回だけ
           * 開き直し、それでも中断されたら理由を出して待機へ戻る。
           *
           * **`retryListening()` に任せると、案内は出るのに合わない文言が出る。** あちらが
           * 出す `SILENT_CLOSE_HINT` は「マイクを押し直してから話しかけてください」＝
           * 押し直せば直る前提だが、中断は押し直しても同じところで打ち切られる。しかも
           * 300msごとに10回開き直すので、そのあいだ画面は「お話しください…」のまま。
           */
          if (abortedRef.current > 0) {
            if (restartAfterAbort()) return;
            if (!closedByUserRef.current && !failedRef.current) setHint(ABORTED_HINT);
            // 聞かずに待機へ戻るなら、保っている接続も要らない（#210）。持ったままだと
            // iOSの録音中の印が待機のあいだも点いたままになる。次に開くときに取り直す。
            releaseMicStream();
            setStatus("idle");
            return;
          }

          if (retryListening()) return;

          // 開き直しを使い切ったときだけ知らせる。利用者が自分で止めたとき・文言付きの
          // エラーで終わったときは、すでに理由が画面に出ている。
          if (!closedByUserRef.current && !failedRef.current) setHint(SILENT_CLOSE_HINT);
          releaseMicStream();
          setStatus("idle");
          return;
        }

        sendRef.current(text);
      };

      const handle = startRecognition(
        {
          onInterim: (text) => {
            if (!current()) return;
            // 届いているうちは生きている。見張りを数え直す（#164）。
            armWatchdog(LISTEN_WATCHDOG_MS);
            setHeard(text);
            if (text !== "") bump();
          },
          onFinal: (text) => {
            if (!current()) return;
            armWatchdog(LISTEN_WATCHDOG_MS);
            finalRef.current += text;
          },
          onSpeechStart: () => {
            if (!current()) return;
            armWatchdog(LISTEN_WATCHDOG_MS);
            // 声が届いた時点で開き直しの回数は仕切り直す。話し出すまでが長かっただけの
            // 往復で、次の番の待ち時間まで短くなっていくのを防ぐ。
            silentRestartsRef.current = 0;
            abortedRef.current = 0;
            // 届いたのだから「聞き取れていないようです」は下げる（#164）。
            setHint(null);
            bump();
          },
          onError: (message, code) => {
            if (!current()) return;

            /*
             * 端末が聞き取りを打ち切った（#197）。こちらの `abort()` は先にハンドラを外して
             * から呼ぶので、ここへ届く `aborted` は端末側の中断しかない。文言はこの場では
             * 出さず（1回きりなら開き直しで直る）、続いたときに `finishTurn()` が出す。
             */
            if (code === RECOGNITION_ABORTED) {
              abortedRef.current += 1;
              return;
            }

            // 正しく終われている（`no-speech` を含む）。中断の連続は途切れた。
            abortedRef.current = 0;
            if (!message) return;
            failedRef.current = true;
            setError(message);
            /*
             * 文言付きのエラーの後、`onend` が来ないことがある（#210）。仕様では `error` の後に
             * 必ず `end` が続くが、iPhoneのPWAでは `audio-capture` の後に「マイクを閉じた」が
             * 一度も記録されず、15秒の見張りに掛かるまで聞き取り中の表示のままだった。
             * 失敗はもう画面に出ているので、「話し終わった」を押したときと同じ短さで畳む。
             */
            armWatchdog(STOP_WATCHDOG_MS);
          },
          onEnd: () => {
            if (!current()) return;
            finishTurn(false);
          },
        },
        // 接続を保っているかも一緒に残す（#205）。`holdMicStream()` は保っていればそのまま
        // 戻る（＝何も記録しない）ため、「保った」の行だけでは往復ごとの有無が読めない。
        `${reason}・接続${isMicStreamHeld() ? "あり" : "なし"}`,
      );

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
      // 開いたきり黙り込んだときの逃げ道を掛ける（#164）。畳む手は「話し終わった」からも使う。
      finishTurnRef.current = finishTurn;
      armWatchdog(LISTEN_WATCHDOG_MS);

      /*
       * マイクの接続を取るのは `start()` が通った後（#179・#210）。上の注記のとおり、実機で
       * 声が届いた聞き取りはすべてこの順だった。押して開いた回は押したボタンからの同期の
       * 流れの中なので、初回の許可の確認もそのまま出せる。
       */
      if (settingsRef.current.holdMicOptIn) holdMicStream();
    },
    [
      armWatchdog,
      bump,
      clearRestartTimer,
      clearWatchdog,
      discardRecognition,
      restartAfterAbort,
      retryListening,
    ],
  );

  /**
   * 読み終えてからマイクへ譲る（#164）。
   *
   * 鳴らしていたものを先に手放し、わずかに待ってから開く。iOSでは読み上げが終わっても
   * 音声の扱いが「再生中」のまま居座ることがあり、間を置かずに開いたマイクへ音が
   * 回ってこない。**待っているあいだ状態は「話しています」のままにしてある**——
   * ここで待機へ落とすと、ロボットが一瞬だけ待ちの姿になってから聞き取りへ移る。
   */
  const resumeAfterSpeaking = useCallback(() => {
    silenceBeforeListening();
    // 保っている接続もここで手放し、開くまでの間を空ける（#210）。`beginListening()` でも
    // 手放すが、そちらは `start()` の直前で間が無い。
    releaseMicStream();
    clearRestartTimer();

    restartTimerRef.current = setTimeout(() => {
      restartTimerRef.current = null;
      beginListeningRef.current(false, LISTEN_REASON.afterSpeech);
    }, RESUME_AFTER_SPEECH_MS);
  }, [clearRestartTimer]);

  useEffect(() => {
    beginListeningRef.current = beginListening;
  }, [beginListening]);

  useEffect(() => {
    resumeAfterSpeakingRef.current = resumeAfterSpeaking;
  }, [resumeAfterSpeaking]);

  /** iOSは「画面を触った流れ」で一度鳴らしておかないと、以降が無音になる。 */
  const prime = useCallback(() => {
    // ENGINEが届くかは先に調べておく。返答が届いてから調べると、届かない端末では
    // 最初のひと声がそのぶん遅れる（#57）。
    warmVoicevoxSource(settingsRef.current.engineUrl);

    /*
     * マイクの接続（#179）はここでは取らない（#210）。以前はここで取っていたが、そうすると
     * 押して開いた回は `start()` より先に接続を持つことになり、実機の記録で声が届かなかった
     * 形（開いた時点で保っている）になる。`beginListening()` が `start()` の後に取る。
     */
    if (primedRef.current) return;
    primeSpeechSynthesis();
    primeVoicevoxAudio();
    primedRef.current = true;
  }, []);

  /** 返答も読み上げも畳んで待機へ戻す。もう聞かなくてよくなったとき。 */
  const stop = useCallback(() => {
    stopEverything();
    setStatus("idle");
  }, [stopEverything]);

  /**
   * 返答の途中で割り込んでそのまま話し始める（#48）。
   *
   * 読み上げを止めて生成を打ち切り、そこまでの返答が記録へ並ぶのを待ってから聞き取りへ入る。
   * 待たずに開くと、打ち切られた往復の後片付けが `idle` を書き込み、開いたばかりの
   * 聞き取り中の表示を上書きしてしまう。
   *
   * 読み上げ中もマイクを開きっぱなしにする常時バージインは採らない。自分の声を聞き返して
   * 往復が止まらなくなるため、割り込みは「押した瞬間に黙る」形にしている。
   */
  const interruptAndListen = useCallback(() => {
    const previousTurn = turnRef.current;

    readerRef.current?.cancel();
    readerRef.current = null;
    abort();

    void (async () => {
      if (previousTurn) await previousTurn;
      beginListening(false, LISTEN_REASON.interrupt);
    })();
  }, [abort, beginListening]);

  const answering = status === "thinking" || status === "preparing" || status === "speaking";
  /**
   * 聞き取りは開いているのに、何も聞こえないまま開き直しが続いている（#164）。
   *
   * 案内（`hint`）そのものを印として使う。別の状態を足すと、消す場所を1つ増やすことになり、
   * 「案内は出ているのにボタンは畳む役割のまま」というずれが生まれる。
   */
  const stalled = status === "listening" && hint === SILENT_CLOSE_HINT;

  /** 中央の大きなボタン。いまの状態によって役割が入れ替わる。 */
  const pressPrimary = useCallback(() => {
    prime();

    if (status === "listening") {
      /*
       * 何も聞き取れないまま開き直しが続いているあいだは、押されても畳まない（#164）。
       *
       * ここで「話し終わった」として待機へ落とすと、案内どおりに押した利用者は
       * もう一度押してからでないと話せない。実際に聞こえていないのだから、押したら
       * その場で開き直すのが素直な意味になる。
       */
      if (stalled) {
        resetRecognition();
        beginListening();
        return;
      }

      // 聞き取り中は「話し終わった」の合図。確定して送信へ進む。
      closedByUserRef.current = true;
      clearRestartTimer();

      // 開き直す合間（マイクが閉じている数百ミリ秒）に押されることがある。そこで
      // 何もしないと、押したのに開き直してしまう（#67）。
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        // 実体が死んでいると `stop()` は何も返さない。押したのに画面が変わらないまま
        // 取り残されるので、返らなければこちらで畳む（#164）。
        armWatchdog(STOP_WATCHDOG_MS);
      } else {
        setStatus("idle");
      }
      return;
    }

    if (answering) {
      interruptAndListen();
      return;
    }

    beginListening();
  }, [
    answering,
    armWatchdog,
    beginListening,
    clearRestartTimer,
    interruptAndListen,
    prime,
    stalled,
    status,
  ]);

  /** 中央のボタンを「話し終わった」（四角）として出すか。聞こえていない間はマイクへ戻す。 */
  const showStop = status === "listening" && !stalled;
  const primaryLabel = stalled
    ? "聞き取り直す"
    : status === "listening"
      ? "話し終わった"
      : answering
        ? "割り込んで話す"
        : "話しかける";

  /** マイクを開く。開いているものがあれば畳んでから開き直す。 */
  const startListening = useCallback(() => beginListening(), [beginListening]);

  /** 走っている往復。割り込む側が並び順を守るために待つ（#48）。 */
  const pendingTurn = useCallback(() => turnRef.current, []);

  return {
    status,
    heard,
    hint,
    notice,
    error,
    activity,
    reacting,
    stalled,
    answering,
    showStop,
    primaryLabel,
    supported,
    setNotice,
    prime,
    pressPrimary,
    beginListening: startListening,
    stop,
    pendingTurn,
  };
}
