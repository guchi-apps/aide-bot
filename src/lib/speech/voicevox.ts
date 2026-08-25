/**
 * VOICEVOXの声での読み上げ（#41）。
 *
 * ブラウザ内蔵の声は端末が持っているものしか選べないため、キャラクターの声にしたい場合は
 * 外部で合成するしかない。ここではWEB版VOICEVOX API（`api.tts.quest`）を使う。
 *
 * **この経路を選んでいる間だけ、返答の文面が第三者のサービスへ送られる。** 聞き取りと内蔵の
 * 読み上げが端末内で完結しているのとは前提が違うので、既定は内蔵の声のままにしてある。
 *
 * APIキーは要らない代わりに、キー無しの利用は**5秒に1リクエスト**に絞られる（超えると
 * 429と`retryAfter`が返る）。1回の返答を文ごとに刻んで投げると必ず引っかかるため、
 * 読み上げは**多くても2リクエスト**に畳んで依頼する（`./synthesis` の `VoicevoxReader`）。
 * 合成中の音声は `mp3StreamingUrl` が生成しながら流してくれるので、出来上がりを待たずに
 * 鳴らし始められる。
 *
 * **キー無しの合成は、依頼してから最初の音が出るまで6〜8秒かかる**（#52で実測。文の長さでは
 * ほとんど変わらない——合成しながら流すため）。内蔵の声が1秒足らずで鳴り始めるのと違い、
 * 何も出さずに待たせると「音が出ない」としか見えない。呼ぶ側は待っていることを画面へ出すこと。
 */

/** `voiceURI` にVOICEVOXの話者を入れるときの接頭辞。内蔵の声の `voiceURI` と混ざらない。 */
export const VOICEVOX_PREFIX = "voicevox:";

const SYNTHESIS_ENDPOINT = "https://api.tts.quest/v3/voicevox/synthesis";

/**
 * 429で待たされる上限。これを超えるなら諦めて内蔵の声へ落とす。
 *
 * 制限に触れた直後の `retryAfter` は5秒前後だが、短い間隔で何度も投げた後は**61秒**が返る
 * （#52で実測）。前者は待てば通るので待ち、後者は会話として待てないので落とす。8秒だと
 * 前者の取りこぼしが出るため、少し余裕を持たせてある。
 */
const MAX_RETRY_WAIT_MS = 20000;

export type VoicevoxSpeaker = {
  /** WEB版VOICEVOX APIの話者ID。 */
  id: number;
  /** 画面の一覧に出す名前。 */
  label: string;
  /** 利用規約で表示が要るクレジット。 */
  credit: string;
};

/**
 * 選べる声。VOICEVOXの話者は多いので、使いそうなものだけを並べる。
 *
 * IDと名前は `GET /v3/voicevox/synthesis` の `speakerName` で実際に確かめたもの
 * （一覧を返すエンドポイントは公開されていない）。
 */
export const VOICEVOX_SPEAKERS: VoicevoxSpeaker[] = [
  { id: 3, label: "ずんだもん（ノーマル）", credit: "VOICEVOX:ずんだもん" },
  { id: 1, label: "ずんだもん（あまあま）", credit: "VOICEVOX:ずんだもん" },
  { id: 7, label: "ずんだもん（ツンツン）", credit: "VOICEVOX:ずんだもん" },
  { id: 22, label: "ずんだもん（ささやき）", credit: "VOICEVOX:ずんだもん" },
  { id: 2, label: "四国めたん", credit: "VOICEVOX:四国めたん" },
  { id: 8, label: "春日部つむぎ", credit: "VOICEVOX:春日部つむぎ" },
  { id: 10, label: "雨晴はう", credit: "VOICEVOX:雨晴はう" },
  { id: 14, label: "冥鳴ひまり", credit: "VOICEVOX:冥鳴ひまり" },
  { id: 16, label: "九州そら", credit: "VOICEVOX:九州そら" },
];

/** `voicevox:3` のような `voiceURI` を話者に戻す。VOICEVOX以外・未知のIDなら `null`。 */
export function parseVoicevoxSpeaker(voiceURI: string | null): VoicevoxSpeaker | null {
  if (!voiceURI || !voiceURI.startsWith(VOICEVOX_PREFIX)) return null;

  const id = Number(voiceURI.slice(VOICEVOX_PREFIX.length));
  return VOICEVOX_SPEAKERS.find((speaker) => speaker.id === id) ?? null;
}

export function voicevoxVoiceURI(speakerId: number): string {
  return `${VOICEVOX_PREFIX}${speakerId}`;
}

type SynthesisResponse = {
  success?: boolean;
  mp3StreamingUrl?: string;
  errorMessage?: unknown;
  retryAfter?: number;
};

/**
 * 合成を依頼し、鳴らせるURLを返す。
 *
 * 混雑して429が返ったときは `retryAfter` 秒だけ待って1度だけやり直す。それでも駄目なら
 * 例外にして、呼ぶ側から内蔵の声へ落とす。
 */
export async function requestVoicevoxAudioUrl(
  text: string,
  speakerId: number,
  signal: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(SYNTHESIS_ENDPOINT, {
      method: "POST",
      // プリフライトを起こさないため、JSONではなくフォーム形式で送る。
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text, speaker: String(speakerId) }),
      signal,
    });

    // 待たされたときは HTTP 429 で返るが、待つ秒数は本文にしか入っていない。
    // ステータスだけを見て投げると、待って出し直せば通る場合まで失敗にしてしまう。
    const result = await (response.json() as Promise<SynthesisResponse>).catch(
      () => ({}) as SynthesisResponse,
    );

    if (result.success && result.mp3StreamingUrl) return result.mp3StreamingUrl;

    const waitMs = (result.retryAfter ?? 0) * 1000;
    if (attempt === 0 && waitMs > 0 && waitMs <= MAX_RETRY_WAIT_MS) {
      await sleep(waitMs, signal);
      continue;
    }

    throw new Error(`voicevox: HTTP ${response.status} ${String(result.errorMessage ?? "")}`);
  }

  throw new Error("voicevox: retry exhausted");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/*
 * 鳴らす `<audio>` は1つだけ作って使い回す。
 *
 * iOSは「画面を触った流れ」で一度 `play()` を通した要素しか、以降の自動再生を許さない。
 * 返答が届いた時点で新しく作った要素では鳴らないため、マイクを押した時点で
 * `primeVoicevoxAudio()` を通したこの要素へ、後から `src` を差し替えて使う。
 */
let sharedAudio: HTMLAudioElement | null = null;

/** 無音のWAV。空の `src` では `play()` が失敗するので、鳴っても聞こえないものを渡す。 */
const SILENT_WAV =
  "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";

/** 合成した音声を鳴らせる端末か。要素は作らない（描画の途中で呼ばれる）。 */
export function isVoicevoxPlaybackSupported(): boolean {
  return typeof window !== "undefined" && typeof Audio !== "undefined";
}

export function getVoicevoxAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;

  sharedAudio ??= new Audio();
  return sharedAudio;
}

/** iOSで後から鳴らせるようにする。マイクを押した流れの中で呼ぶ。 */
export function primeVoicevoxAudio(): void {
  const audio = getVoicevoxAudio();
  if (!audio) return;

  audio.src = SILENT_WAV;
  // 許可を取るだけなので、鳴らせなくてもそのまま進む。
  void audio.play().catch(() => {});
}
