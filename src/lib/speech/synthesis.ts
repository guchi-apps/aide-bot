/**
 * 読み上げ（文字 → 音声）。
 *
 * 読み方は2通りある。既定はブラウザ内蔵の `speechSynthesis` で、返答はストリーミングで
 * 少しずつ届くため、届いた端から文の切れ目で切り出して読み上げる。全部揃うまで待つと、
 * 画面には字幕が出ているのに声が始まらない時間ができる。
 *
 * もう1つはVOICEVOXの声（`./voicevox`）で、こちらは外で合成するぶんレート制限があるため、
 * 1往復あたり最大2回にまとめて依頼する。どちらを使うかは `voiceURI` だけで決まるので、
 * 呼ぶ側は `createReader()` を使う。
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

/**
 * VOICEVOXで「先に合成へ出すぶん」の最小の長さ（#52）。
 *
 * これを下回る1文目（「はい。」など）だけを先に出しても、鳴っている時間より合成の待ちの方が
 * 長くなり、2回目までの間が空くだけになる。短い場合は先出しせず、従来どおり1回にまとめる。
 */
const LEAD_MIN_LENGTH = 12;

/** 読み上げ速度の下限・上限・既定値。`SpeechSynthesisUtterance.rate` の許容範囲より内側に取る。 */
export const RATE_MIN = 0.7;
export const RATE_MAX = 1.6;
export const RATE_DEFAULT = 1.1;

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * この端末に読み上げに使える声が入っているか（#52）。
 *
 * `speechSynthesis` があることと、鳴らせる声があることは別。声が1つも入っていない端末
 * （speech-dispatcherの無いLinuxのChromeなど）では `speak()` は通るのに何も鳴らず、
 * `onend` だけが返る。VOICEVOXから内蔵の声へ落ちた先がここだと、案内も音も無いまま終わる。
 */
function hasInstalledVoice(): boolean {
  if (!isSpeechSynthesisSupported()) return false;
  return window.speechSynthesis.getVoices().length > 0;
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
  /**
   * 声の用意を始めたとき（VOICEVOXのみ・#52）。
   *
   * 外で合成するぶん、依頼してから最初の音が出るまで6〜8秒かかる。何も出さずに待たせると
   * 「音が出ない」としか見えないので、待っていることを画面へ出すために呼ぶ。内蔵の声は
   * すぐ鳴り始めるため呼ばない。
   */
  onPreparing?: () => void;
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
 * キー無しの利用は5秒に1リクエストまでなので、内蔵の声のように文ごとへは刻めない。
 * ただし**依頼から最初の音まで6〜8秒かかる**ため、返答が出そろってから1回だけ出すと、
 * 字幕が出た後に7秒以上の無音ができる（#52。「ずんだもんだと音が出ない」の正体）。
 *
 * そこで**最大2回に分ける**。1文目が揃った時点で1回目を依頼し、返答の生成中に合成を
 * 進めておく。残りは1回目が鳴り始めてから依頼する——そこまでで7秒前後は経っているので、
 * 5秒の制限に触れず、待ちも1回目の再生に隠れる。
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
  /** 先に合成へ出した1文目。まだ出していなければ `null`。 */
  private lead: { text: string; url: Promise<string> } | null = null;

  constructor(
    private readonly speaker: VoicevoxSpeaker,
    private readonly options: ReaderOptions,
  ) {}

  push(text: string): void {
    if (this.cancelled || this.ended) return;

    this.buffer += text;
    if (this.lead) return;

    const chunk = this.takeLeadChunk();
    if (chunk === null) return;

    this.options.onPreparing?.();
    this.lead = {
      text: chunk,
      url: requestVoicevoxAudioUrl(chunk, this.speaker.id, this.controller.signal),
    };
    // 依頼を出しておくだけ。失敗の後始末は finish() の側でまとめて行う。
    void this.lead.url.catch(() => {});
  }

  finish(): void {
    if (this.cancelled || this.ended) return;
    this.ended = true;

    const rest = stripForSpeech(this.buffer).trim();
    this.buffer = "";

    if (!this.lead && rest === "") {
      this.options.onDrain();
      return;
    }

    if (!this.lead) this.options.onPreparing?.();
    void this.run(rest);
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffer = "";
    this.lead = null;

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

  /**
   * 返答の頭を切り出す。まだ先出しできる形になっていなければ `null`。
   *
   * `SpeechReader.takeChunk()` と同じ考え方だが、短すぎる1文は先出ししない。
   */
  private takeLeadChunk(): string | null {
    // 最初の切れ目ではなく、`LEAD_MIN_LENGTH` を越えた先の切れ目で切る。「はい。」のような
    // 短い1文で切ると、鳴っている時間より合成の待ちの方が長くなる。
    const from = LEAD_MIN_LENGTH - 1;
    const boundary = this.buffer.slice(from).search(/[。．！？!?\n]/);

    if (boundary !== -1) {
      const cut = from + boundary + 1;
      const chunk = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      return trimmedForSpeech(chunk);
    }

    if (this.buffer.length < FORCED_BREAK_LENGTH) return null;

    const comma = this.buffer.lastIndexOf("、", FORCED_BREAK_LENGTH);
    const cut = comma > 0 ? comma + 1 : FORCED_BREAK_LENGTH;
    const chunk = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return trimmedForSpeech(chunk);
  }

  /**
   * 合成して鳴らす。最大2回に分ける（#52）。
   *
   * 1回目は `push()` の途中で依頼済みのぶん、2回目が残り。2回目の依頼は1回目が鳴り始めて
   * から出す——合成に7秒前後かかるので、そこまで待てばキー無しの「5秒に1回」に自然と
   * 収まり、待ちも1回目の再生に隠れる。
   */
  private async run(rest: string): Promise<void> {
    const audio = getVoicevoxAudio();
    const leadText = this.lead?.text ?? "";
    const whole = leadText === "" ? rest : `${leadText}\n${rest}`.trim();

    if (!audio) {
      this.fallbackTo(whole, null);
      return;
    }

    const hasSecond = this.lead !== null && rest !== "";
    let second: Promise<string> | null = null;
    const requestSecond = () => {
      if (!hasSecond || second || this.cancelled) return;
      second = requestVoicevoxAudioUrl(rest, this.speaker.id, this.controller.signal);
      void second.catch(() => {});
    };

    try {
      const first = this.lead
        ? await this.lead.url
        : await requestVoicevoxAudioUrl(rest, this.speaker.id, this.controller.signal);
      if (this.cancelled) return;

      await this.playUrl(audio, first, requestSecond);
      if (this.cancelled) return;
    } catch {
      if (this.cancelled) return;

      // 鳴り始めた後で切れたぶんは読み直さない。同じ話を頭から繰り返すほうが分かりにくい。
      if (this.started) {
        this.options.onDrain();
        return;
      }

      this.fallbackTo(whole, `${this.speaker.label}の声が使えなかったので、端末の声で読み上げます。`);
      return;
    }

    if (!hasSecond) {
      this.options.onDrain();
      return;
    }

    try {
      const url = await (second ??
        requestVoicevoxAudioUrl(rest, this.speaker.id, this.controller.signal));
      if (this.cancelled) return;

      await this.playUrl(audio, url, null);
      if (this.cancelled) return;
      this.options.onDrain();
    } catch {
      if (this.cancelled) return;

      // 1文目は鳴っている。残りだけ内蔵の声へ回す（黙って終わらせない）。
      this.fallbackTo(rest, `${this.speaker.label}の声が混み合っているので、残りは端末の声で読み上げます。`);
    }
  }

  /** 1つぶんを鳴らし終えるまで待つ。`onPlaying` は鳴り始めた時点で1度だけ呼ぶ。 */
  private playUrl(
    audio: HTMLAudioElement,
    url: string,
    onPlaying: (() => void) | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const handlePlaying = () => {
        onPlaying?.();
        if (this.started || this.cancelled) return;
        this.started = true;
        this.options.onStart();
      };

      // 中断されたときも必ず畳む。放っておくと run() が待ったまま戻らない。
      const settle = (error?: Error) => {
        audio.removeEventListener("playing", handlePlaying);
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        this.detach = null;

        if (error && !this.cancelled) reject(error);
        else resolve();
      };

      const onEnded = () => settle();
      const onError = () => settle(new Error("voicevox: playback failed"));

      this.detach = () => settle();

      audio.addEventListener("playing", handlePlaying);
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);

      audio.src = url;
      audio.playbackRate = this.options.rate;
      audio.play().catch(onError);
    });
  }

  /** 内蔵の声へ引き継ぐ。`onStart` と `onDrain` はそのまま渡すので、呼ぶ側の流れは変わらない。 */
  private fallbackTo(text: string, notice: string | null): void {
    // 声が1つも入っていない端末では、落とした先でも鳴らない。黙って終わらせず理由を出す。
    if (!hasInstalledVoice()) {
      this.options.onNotice?.(
        `${this.speaker.label}の声が使えず、この端末には読み上げに使える声が入っていません。声の設定から別の声を選んでください。`,
      );
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

/** 読み上げ向けに均したうえで前後の空白を落とす。空になったら `null`。 */
function trimmedForSpeech(text: string): string | null {
  const trimmed = stripForSpeech(text).trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 設定画面の「試し聞き」。選んだ声で1文だけ読む。返り値で途中で止められる。
 *
 * VOICEVOXの声は鳴り始めるまで数秒かかるため、押しても何も起きない時間ができる。
 * 呼ぶ側で `onPreparing` / `onDrain` を受け取ってボタンの表示を変えられるようにしてある。
 */
export function speakSample(
  voiceURI: string | null,
  rate: number,
  handlers: Pick<ReaderOptions, "onPreparing" | "onNotice"> & { onDone?: () => void } = {},
): Reader {
  const reader = createReader({
    voiceURI,
    rate,
    onPreparing: handlers.onPreparing,
    onStart: () => handlers.onDone?.(),
    onDrain: () => handlers.onDone?.(),
    onNotice: handlers.onNotice,
  });

  reader.push("こんにちは。この声で読み上げます。");
  reader.finish();
  return reader;
}
