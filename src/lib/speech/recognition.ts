/**
 * 聞き取り（音声 → 文字）。ブラウザ内蔵の Web Speech API を薄く包む。
 *
 * 外部サービスへ音声を送らないため、APIキーも実費も要らない。代わりに対応ブラウザが
 * Chrome / Edge / Safari に限られ、認識の精度は端末任せになる。呼ぶ側は必ず
 * `isSpeechRecognitionSupported()` で分岐し、使えないときの導線（「書く」モード）を出す。
 */

/** 聞き取りの言語。UIも返答も日本語のため固定する。 */
const RECOGNITION_LANG = "ja-JP";

/**
 * 直近の出来事の記録（#164）。
 *
 * **iOSの実機でしか起きない不具合を、手元で再現せずに追うための唯一の手掛かり。**
 * 「話しても認識されない」という報告は、マイクが開かなかったのか・開いたのに声が届いて
 * いないのか・聞き取れたのに送られていないのかで直すところがまるで違うが、画面には
 * どれも「お話しください…」のまま無反応としか出ない。声の設定から読める形で残す。
 *
 * 残すのは節目だけ（開いた・声が届いた・文字にした・エラー・閉じた）で、途中経過は
 * 入れない。1回の聞き取りで何十行も積むと、肝心の節目が流れて読めなくなる。
 */
export type RecognitionLogEntry = { at: string; text: string };

const LOG_LIMIT = 12;

let log: RecognitionLogEntry[] = [];
const logListeners = new Set<() => void>();

function note(text: string): void {
  const at = new Date().toLocaleTimeString("ja-JP", { hour12: false });
  log = [...log.slice(-(LOG_LIMIT - 1)), { at, text }];
  for (const listener of logListeners) listener();
}

/**
 * 記録の読み出し。`useSyncExternalStore` からそのまま渡せる形にしてある。
 *
 * **中身が変わったときだけ配列を作り直す。** 呼ぶたびに新しい配列を返すと、
 * `useSyncExternalStore` が「毎回変わった」と見なして描画が止まらなくなる。
 */
export function recognitionLog(): RecognitionLogEntry[] {
  return log;
}

export function subscribeRecognitionLog(listener: () => void): () => void {
  logListeners.add(listener);
  return () => {
    logListeners.delete(listener);
  };
}

export type RecognitionHandlers = {
  /** 確定前の途中経過。上書きで表示する。 */
  onInterim: (text: string) => void;
  /** 確定した文。1回の聞き取りの中で複数回呼ばれ、呼ぶ側が繋ぐ。 */
  onFinal: (text: string) => void;
  /** 人の声を検出した瞬間。球の反応に使う。 */
  onSpeechStart: () => void;
  /** 利用者へ出す日本語の文言。`null` は「黙って終わってよい」（無音など）。 */
  onError: (message: string | null) => void;
  /** 成否によらず、聞き取りが終わったときに必ず1回。 */
  onEnd: () => void;
};

export type RecognitionHandle = {
  /** 今の発話を確定させて終える。`onEnd` が続けて呼ばれる。 */
  stop: () => void;
  /** 結果を捨てて終える。画面を離れるときに使う。 */
  abort: () => void;
};

function getConstructor(): typeof SpeechRecognition | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/**
 * 使い回す聞き取りの実体（#155）。
 *
 * **1回ごとに `new` しない。** iOSのWebKitには、`webkitSpeechRecognition` を作り直すと
 * 2回目以降が `start()` しても何も起きずに終わる（`onresult` が一度も来ないまま `onend` だけが
 * 返る）事象が知られている。**「話す」で最初の1往復だけ通り、その後は何を話しても画面に
 * 何も出ない**という報告（#155。iPhoneのホーム画面PWA・「続けて話す」入）の形と一致する。
 *
 * 1つを持ち回してハンドラだけ差し替えれば、`start()` / `stop()` の繰り返しになる。
 * `continuous = false` で1発話ごとに終わる使い方は変えていないので、呼ぶ側からは同じに見える。
 *
 * **ただし「使い回すだけ」では直らなかった**（#164。#155の後もiPhoneのPWAで、返答の読み上げが
 * 終わったあと自動で開いたマイクが声を拾わないままだという報告）。それでも既定は使い回しの
 * ままにしてある——捨てるのは `onend` すら返らなくなった回だけ（`resetRecognition()`）。
 */
let shared: SpeechRecognition | null = null;

function getRecognition(): SpeechRecognition | null {
  const Constructor = getConstructor();
  if (!Constructor) return null;

  if (!shared) {
    shared = new Constructor();
    shared.lang = RECOGNITION_LANG;
    // `continuous` を false にしているのは、黙ったところで自動的に終わらせるため。true にすると
    // 生活音を拾い続けて終わらず、いつ送られるのかが利用者から分からなくなる。
    shared.continuous = false;
    shared.interimResults = true;
    shared.maxAlternatives = 1;
  }

  return shared;
}

export function isSpeechRecognitionSupported(): boolean {
  return getConstructor() !== null;
}

/**
 * 使い回している実体を捨てる（#164）。次の `startRecognition()` は作り直したものを使う。
 *
 * **呼んでよいのは `onend` が返ってこなかった回だけ。**「何も聞こえないまま閉じた」
 * （`no-speech` → `onend`）は実体が生きている証拠なので、そこで捨ててはいけない——
 * 報告された症状では**開き直しのたびにその条件が真になる**ため、実質「毎回作り直す」に
 * なり、#155が名指しで潰した振る舞い（作り直すと2回目以降が `start()` しても何も
 * 起きずに終わる）へ丸ごと戻ってしまう。
 *
 * 捨てるのは「開いたきり黙り込んで `onend` すら返らない」＝実体が死んでいると
 * 見えるときに限る。
 */
export function resetRecognition(): void {
  if (!shared) return;

  clearHandlers(shared);
  try {
    shared.abort();
  } catch {
    // すでに畳まれている。捨てるだけなので、失敗しても続けてよい。
  }

  shared = null;
  note("聞き取りを作り直した");
}

/**
 * エラーコードを利用者向けの文言にする。
 *
 * `no-speech` と `aborted` は「何も言わずに終わった」だけなので、赤字を出さずに黙って戻す。
 * ここで文言を出すと、話しかけようとして止めただけの操作が毎回エラー表示になる。
 */
function describeError(code: string): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "マイクの使用が許可されていません。ブラウザのサイト設定で許可してから、もう一度お試しください。";
    case "audio-capture":
      return "マイクが見つかりませんでした。接続を確認してください。";
    case "network":
      return "聞き取りに必要な通信ができませんでした。通信状況を確認してください。";
    case "language-not-supported":
      return "このブラウザでは日本語の聞き取りに対応していません。「書く」に切り替えてください。";
    default:
      return "聞き取りに失敗しました。もう一度お試しください。";
  }
}

/**
 * 聞き取りを1回ぶん始める。始められなかった場合は `null`。
 *
 * **`null` を返したときは `onError` も `onEnd` も呼ばない。** 直前の聞き取りがまだ畳まれて
 * いないだけのこともあり、そこで赤字を出して終わらせると、少し待てば開けた場面まで失敗に
 * なる。開き直すか諦めるかは呼ぶ側が決める（#67）。
 *
 * 実体は使い回す（`getRecognition()`）。呼ぶたびにハンドラを差し替えるので、**前の回の
 * ハンドラは残らない。**
 */
export function startRecognition(handlers: RecognitionHandlers): RecognitionHandle | null {
  const recognition = getRecognition();
  if (!recognition) return null;

  recognition.onspeechstart = () => {
    note("声が届いた");
    handlers.onSpeechStart();
  };

  recognition.onresult = (event) => {
    let interim = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) {
        note("文字にした");
        handlers.onFinal(transcript);
      } else {
        interim += transcript;
      }
    }

    handlers.onInterim(interim);
  };

  recognition.onerror = (event) => {
    // 文言を出さない `no-speech` も記録には残す。**これが並んでいること自体が、
    // マイクは開いたのに声が一度も届いていないという手掛かりになる**（#164）。
    note(`終わった理由: ${event.error}`);
    handlers.onError(describeError(event.error));
  };

  recognition.onend = () => {
    note("マイクを閉じた");
    handlers.onEnd();
  };

  try {
    recognition.start();
  } catch {
    // 直前の聞き取りがまだ終わっていない場合にここへ来る。二重には始めない。
    note("マイクを開けなかった（前の聞き取りが残っている）");
    return null;
  }

  note("マイクを開いた");

  return {
    // 「話し終わった」。確定した本文を `onEnd` で受け取るので、ハンドラは付けたままにする。
    stop: () => recognition.stop(),
    /**
     * 結果を捨てて終える。**実体を使い回すため、先にハンドラを外す。**
     *
     * 外さずに畳むと、遅れて届く `onend` が——そのころには次の聞き取り用に差し替わっている
     * ——**次の回のハンドラへ入る。** 開いたばかりの聞き取りが「何も聞こえないまま終わった」
     * ことにされてしまう（#155）。
     */
    abort: () => {
      clearHandlers(recognition);
      recognition.abort();
    },
  };
}

/** 使い回す実体からハンドラを外す。 */
function clearHandlers(recognition: SpeechRecognition): void {
  recognition.onspeechstart = null;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
}
