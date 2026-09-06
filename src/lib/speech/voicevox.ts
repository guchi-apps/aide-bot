/**
 * VOICEVOXの声での読み上げ（#41・#57）。
 *
 * ブラウザ内蔵の声は端末が持っているものしか選べないため、キャラクターの声にしたい場合は
 * 外部で合成するしかない。合成の宛先は2つあり、`resolveVoicevoxSource()` が端末ごとに選ぶ。
 *
 * 1. **自前のVOICEVOX ENGINE**（#57）。声の設定に入れたURLへ `/audio_query` → `/synthesis` の
 *    2段で投げる。レート制限が無く、返答の文面が外へ出ていかない。tailnet内のsubpcで動かす
 *    想定なので、tailnet外の端末からは届かない
 * 2. **WEB版VOICEVOX API**（`api.tts.quest`）。ENGINEのURLが未設定か、届かなかったときの宛先
 *
 * **2の経路を通っている間だけ、返答の文面が第三者のサービスへ送られる。** 聞き取りと内蔵の
 * 読み上げが端末内で完結しているのとは前提が違うので、既定は内蔵の声のままにしてある。
 *
 * 2はAPIキーが要らない代わりに、キー無しの利用は**5秒に1リクエスト**に絞られる（超えると
 * 429と`retryAfter`が返る）。1回の返答を文ごとに刻んで投げると必ず引っかかるため、
 * 読み上げは**多くても2リクエスト**に畳んで依頼する（`./synthesis` の `VoicevoxReader`）。
 * 合成中の音声は `mp3StreamingUrl` が生成しながら流してくれるので、出来上がりを待たずに
 * 鳴らし始められる。
 *
 * **2のキー無しの合成は、依頼してから最初の音が出るまで6〜8秒かかる**（#52で実測。文の長さでは
 * ほとんど変わらない——合成しながら流すため）。内蔵の声が1秒足らずで鳴り始めるのと違い、
 * 何も出さずに待たせると「音が出ない」としか見えない。呼ぶ側は待っていることを画面へ出すこと。
 */

/** `voiceURI` にVOICEVOXの話者を入れるときの接頭辞。内蔵の声の `voiceURI` と混ざらない。 */
export const VOICEVOX_PREFIX = "voicevox:";

const WEB_SYNTHESIS_ENDPOINT = "https://api.tts.quest/v3/voicevox/synthesis";

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
 * WEB版APIへ合成を依頼し、鳴らせるURLを返す。
 *
 * 混雑して429が返ったときは `retryAfter` 秒だけ待って1度だけやり直す。それでも駄目なら
 * 例外にして、呼ぶ側から内蔵の声へ落とす。
 */
async function requestWebAudioUrl(
  text: string,
  speakerId: number,
  signal: AbortSignal,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(WEB_SYNTHESIS_ENDPOINT, {
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
 * ここから自前のVOICEVOX ENGINE（#57）。
 *
 * ENGINEのURLは**リポジトリにもクライアントバンドルにも置かない**。tailnetのホスト名であり、
 * このリポジトリも本番サイトも公開されているため、`NEXT_PUBLIC_*` で配ると誰でも読める。
 * 端末ごとに声の設定（localStorage）へ持たせ、この層へは引数で渡ってくる。
 */

/** ENGINEが生きているかを見に行くときの待ち時間。tailnet外では返らないので短く切る。 */
const PROBE_TIMEOUT_MS = 2000;

/** 疎通の判定を使い回す時間。長くすると、subpcが復帰しても切り替わらない。 */
const PROBE_CACHE_MS = 60_000;

/**
 * ENGINEの合成にかける上限。
 *
 * ひと固まりは長くても `FORCED_BREAK_LENGTH`（60文字）なので、届いていれば数秒で返る。
 * **上限が無いと、疎通を確かめた後にtailnetから出た端末で `fetch` がTCPのタイムアウト
 * （数十秒）まで戻らず、「声を用意しています」に張り付く。** #52で潰した「返事が来ていない
 * ように見える」状態がそのまま再発するので、会話として待てる長さで切る。
 */
const ENGINE_TIMEOUT_MS = 10_000;

export type VoicevoxAudio = {
  /** `<audio>` の `src` に入れるURL。 */
  url: string;
  /** 鳴らし終えたら呼ぶ。ENGINEのObjectURLを解放する（WEB版では何もしない）。 */
  release: () => void;
};

export type VoicevoxSource = {
  kind: "engine" | "web";
  /**
   * 1往復をまとめて依頼しなければならないか。
   *
   * WEB版は5秒に1リクエストなので文ごとには刻めない（`./synthesis` が2回に畳む）。
   * ENGINEは制限が無いので、内蔵の声と同じように文の切れ目で刻んで先へ進める。
   */
  rateLimited: boolean;
  synthesize: (text: string, speakerId: number, signal: AbortSignal) => Promise<VoicevoxAudio>;
};

const WEB_SOURCE: VoicevoxSource = {
  kind: "web",
  rateLimited: true,
  synthesize: async (text, speakerId, signal) => ({
    url: await requestWebAudioUrl(text, speakerId, signal),
    release: () => {},
  }),
};

/** 設定に入力されたURLを整える。空・URLとして読めないものは `null`。 */
export function normalizeEngineUrl(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // 末尾のスラッシュを落として `${base}/version` の形に揃える。
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * ENGINEへ合成を依頼する。
 *
 * WEB版と違い2段になっている。`/audio_query` が読み・アクセント・長さを組み立てたJSONを返し、
 * それをそのまま `/synthesis` へ渡すとWAVが返る。**WEB版の `mp3StreamingUrl` のような
 * 途中から流す仕組みは無い**ので、1回に渡す文が長いほど鳴り始めるまで待つことになる。
 * 呼ぶ側（`./synthesis`）はENGINEのときだけ文ごとに刻んで、この待ちを次の再生に隠している。
 *
 * ブラウザから直接叩くため、ENGINE側でCORSを開けておく必要がある（`--cors_policy_mode all`）。
 */
async function requestEngineAudio(
  baseUrl: string,
  text: string,
  speakerId: number,
  signal: AbortSignal,
): Promise<VoicevoxAudio> {
  const speaker = String(speakerId);

  // `text` はクエリ文字列で渡す（ENGINEのAPIがそう決めている）。本文が無いPOSTなので
  // プリフライトは起きない。
  const query = await fetch(
    `${baseUrl}/audio_query?${new URLSearchParams({ text, speaker }).toString()}`,
    { method: "POST", signal },
  );
  if (!query.ok) throw new Error(`voicevox engine: audio_query HTTP ${query.status}`);

  const audioQuery: unknown = await query.json();

  const synthesis = await fetch(`${baseUrl}/synthesis?${new URLSearchParams({ speaker })}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(audioQuery),
    signal,
  });
  if (!synthesis.ok) throw new Error(`voicevox engine: synthesis HTTP ${synthesis.status}`);

  const url = URL.createObjectURL(await synthesis.blob());
  return { url, release: () => URL.revokeObjectURL(url) };
}

function engineSource(baseUrl: string): VoicevoxSource {
  return {
    kind: "engine",
    rateLimited: false,
    synthesize: (text, speakerId, signal) =>
      requestEngineAudio(baseUrl, text, speakerId, withTimeout(signal, ENGINE_TIMEOUT_MS)),
  };
}

/** 呼ぶ側の中断に、時間切れを足したシグナルを作る。 */
function withTimeout(signal: AbortSignal, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("voicevox engine: timeout")), ms);

  const done = () => clearTimeout(timer);
  controller.signal.addEventListener("abort", done, { once: true });

  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });

  return controller.signal;
}

let probeCache: { baseUrl: string; at: number; reachable: Promise<boolean> } | null = null;

/**
 * ENGINEが届くかを見る。tailnet外の端末では返ってこないので、短い時間で切る。
 *
 * 判定は少しのあいだ使い回す。ひと往復のたびに待たせないためで、外れたときは
 * `forgetVoicevoxEngine()` で捨てる。
 */
function probeEngine(baseUrl: string): Promise<boolean> {
  const now = Date.now();
  if (probeCache && probeCache.baseUrl === baseUrl && now - probeCache.at < PROBE_CACHE_MS) {
    return probeCache.reachable;
  }

  const reachable = fetch(`${baseUrl}/version`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then((response) => response.ok)
    .catch(() => false);

  probeCache = { baseUrl, at: now, reachable };
  return reachable;
}

/** 疎通の判定を捨てる。ENGINEへの合成が失敗したときに呼び、次はWEB版へ回れるようにする。 */
export function forgetVoicevoxEngine(): void {
  probeCache = null;
}

/** この端末が使う宛先を決める。ENGINEが届かなければWEB版。 */
export async function resolveVoicevoxSource(engineUrl: string | null): Promise<VoicevoxSource> {
  const baseUrl = normalizeEngineUrl(engineUrl);
  if (!baseUrl) return WEB_SOURCE;

  return (await probeEngine(baseUrl)) ? engineSource(baseUrl) : WEB_SOURCE;
}

/**
 * 疎通の判定を先に済ませておく。マイクを押した時点で呼ぶ。
 *
 * 返答が届いてから調べると、届かない端末では最初のひと声が最大 `PROBE_TIMEOUT_MS` 遅れる。
 */
export function warmVoicevoxSource(engineUrl: string | null): void {
  const baseUrl = normalizeEngineUrl(engineUrl);
  if (baseUrl) void probeEngine(baseUrl);
}

export type EngineCheck = { ok: true; version: string } | { ok: false; message: string };

/** 設定画面の「接続を確かめる」。判定を取り直すので、直したURLがその場で効く。 */
export async function checkVoicevoxEngine(engineUrl: string): Promise<EngineCheck> {
  const baseUrl = normalizeEngineUrl(engineUrl);
  if (!baseUrl) return { ok: false, message: "URLの形が正しくありません。" };

  const remember = (reachable: boolean) => {
    probeCache = { baseUrl, at: Date.now(), reachable: Promise.resolve(reachable) };
  };

  try {
    const response = await fetch(`${baseUrl}/version`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    remember(response.ok);
    if (!response.ok) return { ok: false, message: `つながりましたが HTTP ${response.status} でした。` };

    const version = (await response.text()).replace(/"/g, "").trim();
    return { ok: true, version: version === "" ? "不明" : version };
  } catch {
    remember(false);
    return {
      ok: false,
      message: "つながりませんでした。tailnetに入っているか、subpcで動いているかを確かめてください。",
    };
  }
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

/**
 * 鳴らしているものを止めて、音声要素を空にする（#164）。
 *
 * **要素そのものは捨てない。** `primeVoicevoxAudio()` で許可を通したこの1つを使い回すのが
 * iOSで鳴らせる前提で、しかも `prime()` は1回きりなので、差し替えると以降のVOICEVOXが
 * 丸ごと無音になる。止めるのは再生中の音の方で、読み上げが終わってもiOSの音声の扱いが
 * 「再生中」のまま居座り、続けて開いたマイクへ音が回ってこない——というのが#164で
 * いちばん疑わしい形。要素が無いなら作らずに戻る。
 *
 * **名前を `release` にしないこと。** 合成し終えた音声を手放す `VoicevoxAudio.release`
 * （ObjectURLの解放）がすでにあり、別物と紛らわしくなる。
 */
export function stopVoicevoxAudio(): void {
  if (!sharedAudio) return;

  sharedAudio.pause();
  sharedAudio.removeAttribute("src");
  sharedAudio.load();
}

/** iOSで後から鳴らせるようにする。マイクを押した流れの中で呼ぶ。 */
export function primeVoicevoxAudio(): void {
  const audio = getVoicevoxAudio();
  if (!audio) return;

  audio.src = SILENT_WAV;
  // 許可を取るだけなので、鳴らせなくてもそのまま進む。
  void audio.play().catch(() => {});
}
