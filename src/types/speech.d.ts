/**
 * Web Speech API（音声認識）の型宣言。
 *
 * `SpeechSynthesis` 側は TypeScript の標準ライブラリ（lib.dom.d.ts）に入っているが、
 * `SpeechRecognition` は仕様が W3C の勧告候補どまりのため入っていない。使う範囲だけを
 * ここで宣言する。依存を増やさずに済ませるための最小限で、仕様の全部は写していない。
 *
 * Chrome / Edge / Safari はいずれも接頭辞付きの `webkitSpeechRecognition` を実装しており、
 * 接頭辞なしの `SpeechRecognition` を持つのは一部だけ。両方を optional で宣言しておき、
 * 実際にどちらがあるかは `src/lib/speech/recognition.ts` が見る。
 */

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  /** `no-speech` / `not-allowed` / `service-not-allowed` / `audio-capture` / `network` など。 */
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;

  start(): void;
  stop(): void;
  abort(): void;

  onresult: ((this: SpeechRecognition, event: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognition, event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognition, event: Event) => void) | null;
  onspeechstart: ((this: SpeechRecognition, event: Event) => void) | null;
}

declare const SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
