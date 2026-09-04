/**
 * 聞き取り（音声 → 文字）。ブラウザ内蔵の Web Speech API を薄く包む。
 *
 * 外部サービスへ音声を送らないため、APIキーも実費も要らない。代わりに対応ブラウザが
 * Chrome / Edge / Safari に限られ、認識の精度は端末任せになる。呼ぶ側は必ず
 * `isSpeechRecognitionSupported()` で分岐し、使えないときの導線（「書く」モード）を出す。
 */

/** 聞き取りの言語。UIも返答も日本語のため固定する。 */
const RECOGNITION_LANG = "ja-JP";

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

  recognition.onspeechstart = () => handlers.onSpeechStart();

  recognition.onresult = (event) => {
    let interim = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result[0]?.transcript ?? "";
      if (result.isFinal) handlers.onFinal(transcript);
      else interim += transcript;
    }

    handlers.onInterim(interim);
  };

  recognition.onerror = (event) => handlers.onError(describeError(event.error));
  recognition.onend = () => handlers.onEnd();

  try {
    recognition.start();
  } catch {
    // 直前の聞き取りがまだ終わっていない場合にここへ来る。二重には始めない。
    return null;
  }

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
