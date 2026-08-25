/**
 * 読み上げ（文字 → 音声）。
 *
 * 読み方は2通りある。既定はブラウザ内蔵の `speechSynthesis` で、返答はストリーミングで
 * 少しずつ届くため、届いた端から文の切れ目で切り出して読み上げる。全部揃うまで待つと、
 * 画面には字幕が出ているのに声が始まらない時間ができる。
 *
 * もう1つはVOICEVOXの声（`./voicevox`）で、こちらは返答が出そろってから1回で合成する。
 * どちらを使うかは `voiceURI` だけで決まるので、呼ぶ側は `createReader()` を使う。
 */

import {
  getVoicevoxAudio,
  isVoicevoxPlaybackSupported,
  parseVoicevoxSpeaker,
  requestVoicevoxAudioUrl,
  type VoicevoxSpeaker,
} from "./voicevox";

/** 文の切れ目が来ないまま溜まった場合に、ここで一度区切る長さ。 */
const FORCED_BREAK_LENGTH = 60;

/** 読み上げ速度の下限・上限・既定値。`SpeechSynthesisUtterance.rate` の許容範囲より内側に取る。 */
export const RATE_MIN = 0.7;
export const RATE_MAX = 1.6;
export const RATE_DEFAULT = 1.1;

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * 日本語の声を集める。
 *
 * `getVoices()` は最初の呼び出しで空配列を返すことがあり、そのときは `voiceschanged` の後に
 * 揃う。呼ぶ側が両方を書かずに済むよう、コールバックで渡す。戻り値は購読の解除。
 */
export function watchJapaneseVoices(
  onChange: (voices: SpeechSynthesisVoice[]) => void,
): () => void {
  if (!isSpeechSynthesisSupported()) return () => {};

  const pick = () => {
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith("ja"));
    onChange(voices);
  };

  pick();
  window.speechSynthesis.addEventListener("voiceschanged", pick);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", pick);
}

/**
 * iOSで読み上げを使えるようにする。
 *
 * iOS Safari は「画面を触った流れ」の中で一度 `speak()` を呼んでおかないと、以降の読み上げが
 * 無音のまま終わる。マイクを押した時点でこれを呼び、そのときの操作を許可として使う。
 * 空文字は実装によっては無視されるため、読み上げても聞こえない空白を1つ渡す。
 */
export function primeSpeechSynthesis(): void {
  if (!isSpeechSynthesisSupported()) return;

  const utterance = new SpeechSynthesisUtterance(" ");
  utterance.volume = 0;
  window.speechSynthesis.speak(utterance);
}

/**
 * 読み上げ向けに文字を均す。
 *
 * 音声モードでは記号の少ない返答を求めているが、モデルが見出しや箇条書きを混ぜてくることは
 * ある。そのまま渡すと「シャープ」「アスタリスク」と読む声があるため、ここで落とす。
 */
export function stripForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "（コードは画面をご覧ください）")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n");
}

type ReaderOptions = {
  voiceURI: string | null;
  rate: number;
  /** 最初のひと声が実際に鳴り始めたとき。 */
  onStart: () => void;
  /** 読み上げるものが無くなったとき（`finish()` の後に限る）。 */
  onDrain: () => void;
  /** 声を選び直したなど、利用者へ伝えておきたいことが起きたとき。 */
  onNotice?: (message: string) => void;
};

/**
 * 読み上げの受け口。
 *
 * `push()` で本文を継ぎ足し、本文が終わったら `finish()`。読み終えると `onDrain` が1回鳴る。
 * 内蔵の声とVOICEVOXで実体は違うが、呼ぶ側からは同じに見える。
 */
export type Reader = {
  push: (text: string) => void;
  finish: () => void;
  cancel: () => void;
};

/** その `voiceURI` でこの端末が読み上げられるか。 */
export function canSpeakWith(voiceURI: string | null): boolean {
  if (parseVoicevoxSpeaker(voiceURI)) return isVoicevoxPlaybackSupported();
  return isSpeechSynthesisSupported();
}

/** `voiceURI` に合った読み手を作る。 */
export function createReader(options: ReaderOptions): Reader {
  const speaker = parseVoicevoxSpeaker(options.voiceURI);
  return speaker ? new VoicevoxReader(speaker, options) : new SpeechReader(options);
}

/**
 * 届いた順に読み上げていくキュー。
 *
 * `push()` で本文を継ぎ足し、文の切れ目まで揃ったぶんだけを `speechSynthesis` へ渡す。
 * 本文が終わったら `finish()` を呼ぶ。全部読み終えた時点で `onDrain` が1回だけ鳴る。
 */
export class SpeechReader {
  private buffer = "";
  private pending = 0;
  private ended = false;
  private cancelled = false;
  private started = false;

  constructor(private readonly options: ReaderOptions) {}

  push(text: string): void {
    if (this.cancelled || this.ended) return;

    this.buffer += text;

    for (;;) {
      const chunk = this.takeChunk();
      if (chunk === null) break;
      this.speak(chunk);
    }
  }

  /** これ以上本文は来ないと伝える。残りを読み切ったら `onDrain`。 */
  finish(): void {
    if (this.cancelled || this.ended) return;
    this.ended = true;

    const rest = this.buffer.trim();
    this.buffer = "";
    if (rest !== "") this.speak(rest);

    if (this.pending === 0) this.options.onDrain();
  }

  /** 読み上げを途中で止める。`onDrain` は鳴らさない（止めたのは利用者のため）。 */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffer = "";
    this.pending = 0;

    if (isSpeechSynthesisSupported()) window.speechSynthesis.cancel();
  }

  /**
   * 読み上げに回せるひと固まりを切り出す。まだ切れ目が無ければ `null`。
   *
   * 句点・感嘆符・改行で切る。それらが来ないまま長くなった場合は読点で、読点も無ければ
   * 長さで割る。1回の `speak()` が長すぎると、途中で打ち切る実装（Chrome）に当たる。
   */
  private takeChunk(): string | null {
    const boundary = this.buffer.search(/[。．！？!?\n]/);

    if (boundary !== -1) {
      const chunk = this.buffer.slice(0, boundary + 1);
      this.buffer = this.buffer.slice(boundary + 1);
      return chunk.trim() === "" ? "" : chunk;
    }

    if (this.buffer.length < FORCED_BREAK_LENGTH) return null;

    const comma = this.buffer.lastIndexOf("、", FORCED_BREAK_LENGTH);
    const cut = comma > 0 ? comma + 1 : FORCED_BREAK_LENGTH;
    const chunk = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return chunk;
  }

  private speak(rawText: string): void {
    const text = stripForSpeech(rawText).trim();
    if (text === "" || !isSpeechSynthesisSupported()) return;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ja-JP";
    utterance.rate = this.options.rate;

    if (this.options.voiceURI) {
      const voice = window.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.voiceURI === this.options.voiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => {
      if (this.started || this.cancelled) return;
      this.started = true;
      this.options.onStart();
    };

    // 読み上げに失敗しても、そこで固まらせない。次の固まりへ進める。
    const settle = () => {
      if (this.cancelled) return;
      this.pending -= 1;
      if (this.pending === 0 && this.ended) this.options.onDrain();
    };

    utterance.onend = settle;
    utterance.onerror = settle;

    this.pending += 1;
    window.speechSynthesis.speak(utterance);
  }
}

/**
 * VOICEVOXで読み上げる。
 *
 * キー無しの利用は5秒に1リクエストまでなので、文ごとに刻まず、`finish()` の時点で
 * 本文をまとめて1回だけ合成へ出す。返ってくるURLは合成しながら流れてくるため、
 * 出来上がりを待たずに鳴らし始められる。
 *
 * 合成にも再生にも失敗したときは、黙り込ませずに内蔵の声へ落とす。ここで止めると、
 * 外部サービスが混んでいるだけで秘書が何も答えなくなってしまう。
 */
class VoicevoxReader implements Reader {
  private buffer = "";
  private ended = false;
  private cancelled = false;
  private started = false;
  private readonly controller = new AbortController();
  private fallback: SpeechReader | null = null;
  private detach: (() => void) | null = null;

  constructor(
    private readonly speaker: VoicevoxSpeaker,
    private readonly options: ReaderOptions,
  ) {}

  push(text: string): void {
    if (this.cancelled || this.ended) return;
    this.buffer += text;
  }

  finish(): void {
    if (this.cancelled || this.ended) return;
    this.ended = true;

    const text = stripForSpeech(this.buffer).trim();
    this.buffer = "";

    if (text === "") {
      this.options.onDrain();
      return;
    }

    void this.play(text);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffer = "";

    this.detach?.();
    this.detach = null;
    this.controller.abort();

    this.fallback?.cancel();
    this.fallback = null;

    const audio = getVoicevoxAudio();
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
  }

  private async play(text: string): Promise<void> {
    const audio = getVoicevoxAudio();

    if (!audio) {
      this.fallbackTo(text, null);
      return;
    }

    try {
      const url = await requestVoicevoxAudioUrl(text, this.speaker.id, this.controller.signal);
      if (this.cancelled) return;
      await this.playUrl(audio, url);
    } catch {
      if (this.cancelled) return;

      // 鳴り始めた後で切れたぶんは読み直さない。同じ話を頭から繰り返すほうが分かりにくい。
      if (this.started) {
        this.options.onDrain();
        return;
      }

      this.fallbackTo(text, `${this.speaker.label}の声が使えなかったので、端末の声で読み上げます。`);
    }
  }

  private playUrl(audio: HTMLAudioElement, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const onPlaying = () => {
        if (this.started || this.cancelled) return;
        this.started = true;
        this.options.onStart();
      };

      const onEnded = () => {
        this.detach?.();
        this.detach = null;
        if (this.cancelled) return;
        this.options.onDrain();
        resolve();
      };

      const onError = () => {
        this.detach?.();
        this.detach = null;
        if (this.cancelled) return;
        reject(new Error("voicevox: playback failed"));
      };

      this.detach = () => {
        audio.removeEventListener("playing", onPlaying);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
      };

      audio.addEventListener("playing", onPlaying);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      audio.src = url;
      audio.playbackRate = this.options.rate;
      audio.play().catch(onError);
    });
  }

  /** 内蔵の声へ引き継ぐ。`onStart` と `onDrain` はそのまま渡すので、呼ぶ側の流れは変わらない。 */
  private fallbackTo(text: string, notice: string | null): void {
    if (!isSpeechSynthesisSupported()) {
      this.options.onNotice?.(notice ?? "この端末では読み上げができませんでした。");
      this.options.onDrain();
      return;
    }

    if (notice) this.options.onNotice?.(notice);

    const reader = new SpeechReader({
      voiceURI: null,
      rate: this.options.rate,
      onStart: this.options.onStart,
      onDrain: this.options.onDrain,
    });

    this.fallback = reader;
    reader.push(text);
    reader.finish();
  }
}

/** 設定画面の「試し聞き」。選んだ声で1文だけ読む。返り値で途中で止められる。 */
export function speakSample(
  voiceURI: string | null,
  rate: number,
  onNotice?: (message: string) => void,
): Reader {
  const reader = createReader({
    voiceURI,
    rate,
    onStart: () => {},
    onDrain: () => {},
    onNotice,
  });

  reader.push("こんにちは。この声で読み上げます。");
  reader.finish();
  return reader;
}
