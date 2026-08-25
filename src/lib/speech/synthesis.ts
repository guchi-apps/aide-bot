/**
 * 読み上げ（文字 → 音声）。
 *
 * 読み方は2通りある。既定はブラウザ内蔵の `speechSynthesis` で、返答はストリーミングで
 * 少しずつ届くため、届いた端から文の切れ目で切り出して読み上げる。全部揃うまで待つと、
 * 画面には字幕が出ているのに声が始まらない時間ができる。
 *
 * もう1つはVOICEVOXの声（`./voicevox`）。宛先が2つあり、自前のVOICEVOX ENGINEが届く端末では
 * 内蔵の声と同じように文の切れ目で刻み、届かない端末ではWEB版API（レート制限あり）へ
 * 1往復あたり最大2回にまとめて依頼する。どちらを使うかは `voiceURI` だけで決まるので、
 * 呼ぶ側は `createReader()` を使う。
 */

import {
  forgetVoicevoxEngine,
  getVoicevoxAudio,
  isVoicevoxPlaybackSupported,
  parseVoicevoxSpeaker,
  resolveVoicevoxSource,
  type VoicevoxAudio,
  type VoicevoxSource,
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
   * 自前のVOICEVOX ENGINEのURL（#57）。届けばこちらで合成する。
   *
   * tailnetのホスト名なのでリポジトリにもバンドルにも置かず、端末ごとの設定から渡ってくる。
   * 未設定・届かない端末では従来どおりWEB版API（`api.tts.quest`）を使う。
   */
  engineUrl?: string | null;
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

/** 合成へ回すひと固まり。 */
type VoicevoxChunk = {
  text: string;
  /** 合成の依頼。まだ出していなければ `null`。 */
  audio: Promise<VoicevoxAudio> | null;
};

/**
 * VOICEVOXで読み上げる。
 *
 * 刻み方は宛先で変わる（`./voicevox` の `resolveVoicevoxSource()` が端末ごとに決める）。
 *
 * - **自前のENGINE**（#57）: レート制限が無いので、内蔵の声と同じく文の切れ目で刻む。
 *   ENGINEは合成し終えてからWAVを返す（途中から流す仕組みが無い）ため、まとめて投げると
 *   長い返答ほど鳴り始めが遅くなる。刻んでおけば、次のぶんの合成が前のぶんの再生に隠れる
 * - **WEB版API**: キー無しは5秒に1リクエストなので文ごとへは刻めない。かつ**依頼から
 *   最初の音まで6〜8秒かかる**ため、返答が出そろってから1回だけ出すと字幕の後に7秒以上の
 *   無音ができる（#52。「ずんだもんだと音が出ない」の正体）。そこで**最大2回に分ける**。
 *   1文目が揃った時点で1回目を依頼し、残りは1回目が鳴り始めてから依頼する
 *
 * どちらでも、依頼を出した順にそのまま鳴らす。合成にも再生にも失敗したときは、黙り込ませずに
 * 内蔵の声へ落とす。ここで止めると、外部サービスが混んでいるだけで秘書が何も答えなくなる。
 */
class VoicevoxReader implements Reader {
  private buffer = "";
  private ended = false;
  private cancelled = false;
  private started = false;
  private readonly controller = new AbortController();
  private fallback: SpeechReader | null = null;
  private detach: (() => void) | null = null;
  /** 依頼した順のひと固まり。この順にそのまま鳴らす。 */
  private readonly chunks: VoicevoxChunk[] = [];
  /** 決まった宛先。疎通を調べている間は `null`。 */
  private source: VoicevoxSource | null = null;
  private readonly sourceReady: Promise<VoicevoxSource>;

  constructor(
    private readonly speaker: VoicevoxSpeaker,
    private readonly options: ReaderOptions,
  ) {
    this.sourceReady = resolveVoicevoxSource(options.engineUrl ?? null);

    void this.sourceReady.then((source) => {
      this.source = source;
      // `finish()` 済みなら `run()` が引き取る。ここで刻むと二重に切り出してしまう。
      if (this.cancelled || this.ended) return;
      this.pump(source);
    });
  }

  push(text: string): void {
    if (this.cancelled || this.ended) return;

    this.buffer += text;
    if (this.source) this.pump(this.source);
  }

  finish(): void {
    if (this.cancelled || this.ended) return;
    this.ended = true;
    void this.run();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.buffer = "";

    this.detach?.();
    this.detach = null;
    this.controller.abort();
    this.releaseFrom(0);
    this.chunks.length = 0;

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
   * 届いているぶんから、宛先に合った刻み方でひと固まりずつ切り出して依頼する。
   *
   * WEB版はレート制限があるので、生成中に先出しできるのは1文目だけ。残りは `run()` が
   * 1文目の再生を待ってから依頼する。
   */
  private pump(source: VoicevoxSource): void {
    if (this.cancelled) return;

    if (source.rateLimited) {
      if (this.chunks.length > 0) return;

      const lead = this.takeLeadChunk();
      if (lead === null) return;

      this.enqueue(lead, source);
      return;
    }

    for (;;) {
      const chunk = this.takeChunk();
      if (chunk === null) break;
      if (chunk !== "") this.enqueue(chunk, source);
    }
  }

  private enqueue(text: string, source: VoicevoxSource): void {
    const chunk: VoicevoxChunk = { text, audio: null };
    this.chunks.push(chunk);
    this.request(chunk, source);
  }

  /** まだ出していなければ合成を依頼する。すでに出していれば同じ約束を返す。 */
  private request(chunk: VoicevoxChunk, source: VoicevoxSource): Promise<VoicevoxAudio> {
    if (!chunk.audio) {
      // 鳴り始める前は「声を用意しています」を出す。何も出さずに待たせると、返事が
      // 来ていないように見えてマイクで割り込まれる（#52）。
      if (!this.started) this.options.onPreparing?.();

      chunk.audio = source.synthesize(chunk.text, this.speaker.id, this.controller.signal);
      // 先に依頼だけ出しておくぶんの後始末。失敗は `run()` の側でまとめて拾う。
      void chunk.audio.catch(() => {});
    }

    return chunk.audio;
  }

  /**
   * 文の切れ目でひと固まり切り出す。まだ切れ目が無ければ `null`、読むものが無ければ空文字。
   *
   * `SpeechReader.takeChunk()` と同じ切り方。ENGINE向け。
   */
  private takeChunk(): string | null {
    const boundary = this.buffer.search(/[。．！？!?\n]/);
    let cut: number;

    if (boundary !== -1) {
      cut = boundary + 1;
    } else if (this.buffer.length >= FORCED_BREAK_LENGTH) {
      const comma = this.buffer.lastIndexOf("、", FORCED_BREAK_LENGTH);
      cut = comma > 0 ? comma + 1 : FORCED_BREAK_LENGTH;
    } else {
      return null;
    }

    const chunk = this.buffer.slice(0, cut);
    this.buffer = this.buffer.slice(cut);
    return trimmedForSpeech(chunk) ?? "";
  }

  /**
   * 返答の頭を切り出す。まだ先出しできる形になっていなければ `null`。WEB版向け。
   *
   * 最初の切れ目ではなく、`LEAD_MIN_LENGTH` を越えた先の切れ目で切る。「はい。」のような
   * 短い1文で切ると、鳴っている時間より合成の待ちの方が長くなる。
   */
  private takeLeadChunk(): string | null {
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
   * 依頼した順に鳴らす。
   *
   * 次のぶんの依頼は、いまのぶんが鳴り始めた時点で出す。ENGINEでは合成が再生に隠れ、
   * WEB版では「5秒に1回」の間隔がそこまで待つだけで自然に空く。
   */
  private async run(): Promise<void> {
    const audio = getVoicevoxAudio();
    const source = this.source ?? (await this.sourceReady.catch(() => null));
    if (this.cancelled || !source) return;
    this.source = source;

    // 宛先が決まる前に届いていたぶんも含めて、残りを全部切り出す。WEB版では刻まない——
    // ここまで来ると生成は終わっており、分けても合成の待ちが2回ぶんになるだけになる。
    if (!source.rateLimited) this.pump(source);
    const rest = trimmedForSpeech(this.buffer);
    this.buffer = "";
    if (rest !== null) this.chunks.push({ text: rest, audio: null });

    if (this.chunks.length === 0) {
      this.options.onDrain();
      return;
    }

    if (!audio) {
      this.fallbackTo(this.remainingText(0), null);
      return;
    }

    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index];
      let playing = false;

      try {
        const ready = await this.request(chunk, source);
        if (this.cancelled) return;

        await this.playUrl(audio, ready.url, () => {
          playing = true;
          const next = this.chunks[index + 1];
          if (next) this.request(next, source);
        });
        ready.release();
        if (this.cancelled) return;
      } catch {
        if (this.cancelled) return;

        // ENGINEが落ちていた場合は判定を捨てて、次の往復からWEB版へ回れるようにする。
        if (source.kind === "engine") forgetVoicevoxEngine();

        // 鳴り始めたぶんは読み直さない。同じ話を頭から繰り返すほうが分かりにくい。
        const from = playing ? index + 1 : index;
        this.releaseFrom(from);

        const remaining = this.remainingText(from);
        if (remaining === "") {
          this.options.onDrain();
          return;
        }

        this.fallbackTo(
          remaining,
          this.started
            ? `${this.speaker.label}の声が混み合っているので、残りは端末の声で読み上げます。`
            : `${this.speaker.label}の声が使えなかったので、端末の声で読み上げます。`,
        );
        return;
      }
    }

    this.options.onDrain();
  }

  /** まだ鳴らしていないぶんの本文。内蔵の声へ引き継ぐときに使う。 */
  private remainingText(from: number): string {
    return this.chunks
      .slice(from)
      .map((chunk) => chunk.text)
      .join("\n")
      .trim();
  }

  /** 合成し終えた音声を手放す。ENGINEのObjectURLを溜め込まないため。 */
  private releaseFrom(from: number): void {
    for (const chunk of this.chunks.slice(from)) {
      void chunk.audio?.then((ready) => ready.release()).catch(() => {});
    }
  }

  /** 1つぶんを鳴らし終えるまで待つ。`onPlaying` は鳴り始めた時点で1度だけ呼ぶ。 */
  private playUrl(
    audio: HTMLAudioElement,
    url: string,
    onPlaying: (() => void) | null,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // 「鳴り始めた」を先に伝えてから次のぶんを頼む。逆にすると、すでに鳴っているのに
      // 「声を用意しています」が1度きり挟まる。
      const handlePlaying = () => {
        if (!this.started && !this.cancelled) {
          this.started = true;
          this.options.onStart();
        }
        onPlaying?.();
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
  handlers: Pick<ReaderOptions, "onPreparing" | "onNotice" | "engineUrl"> & {
    onDone?: () => void;
  } = {},
): Reader {
  const reader = createReader({
    voiceURI,
    rate,
    engineUrl: handlers.engineUrl,
    onPreparing: handlers.onPreparing,
    onStart: () => handlers.onDone?.(),
    onDrain: () => handlers.onDone?.(),
    onNotice: handlers.onNotice,
  });

  reader.push("こんにちは。この声で読み上げます。");
  reader.finish();
  return reader;
}
