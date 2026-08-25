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
 * `continuous` を false にしているのは、黙ったところで自動的に終わらせるため。true にすると
 * 生活音を拾い続けて終わらず、いつ送られるのかが利用者から分からなくなる。
 *
 * **`null` を返したときは `onError` も `onEnd` も呼ばない。** 直前の聞き取りがまだ畳まれて
 * いないだけのこともあり、そこで赤字を出して終わらせると、少し待てば開けた場面まで失敗に
 * なる。開き直すか諦めるかは呼ぶ側が決める（#67）。
 */
export function startRecognition(handlers: RecognitionHandlers): RecognitionHandle | null {
  const Constructor = getConstructor();
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.lang = RECOGNITION_LANG;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

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
    stop: () => recognition.stop(),
    abort: () => recognition.abort(),
  };
}
