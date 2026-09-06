"use client";

import { useSyncExternalStore } from "react";

import { RATE_DEFAULT, RATE_MAX, RATE_MIN } from "./synthesis";
import { isSpeechRecognitionSupported } from "./recognition";
import { VOICEVOX_PREFIX, parseVoicevoxSpeaker } from "./voicevox";

/** 端末ごとの好み。相談の内容ではないのでDBへは持たず、その端末のlocalStorageに置く。 */
const STORAGE_KEY = "aide-bot-voice-settings";

export type VoiceSettings = {
  /** 読み上げが終わったら自動でまた聞き取りを始める。 */
  continuous: boolean;
  /** 読み上げそのものの入切。 */
  speak: boolean;
  /**
   * 読み上げる声。`null` は端末におまかせ。
   *
   * VOICEVOXの声は `voicevox:<話者ID>`（`./voicevox` の `VOICEVOX_PREFIX`）で表す。
   * 端末内蔵の声の `voiceURI` とは形が違うので、この1つの値で読み方まで決まる。
   */
  voiceURI: string | null;
  rate: number;
  /**
   * 自前のVOICEVOX ENGINEのURL（#57）。空ならWEB版API（`api.tts.quest`）を使う。
   *
   * **環境変数では配らない。** tailnetのホスト名であり、このリポジトリも本番サイトも公開
   * されているため、`NEXT_PUBLIC_*` に置くとJSバンドル越しに誰でも読める。端末ごとに入れる。
   */
  engineUrl: string;
  /**
   * 往復のあいだ、マイクの接続を掴んだままにする（#179）。**既定は切**（#197で入から変えた）。
   *
   * iPhoneのホーム画面PWAで、読み上げのあとに開いたマイクが音を拾わなくなる症状の対策として
   * 既定で入にしていたが、その端末では**1往復目しか通らないまま——つまり目的を達成しない
   * まま——2往復目以降が `aborted`（端末側の中断）で終わる**という報告になった（#197）。
   * 掴んだ接続が聞き取りと録音を取り合っている疑いがあるので、まず既定を切にしてある。
   *
   * **保存済みの設定を無効にするため、キーの名前ごと `holdMic` から変えてある。** 既定値だけを
   * `false` にしても、localStorageに残った `holdMic: true` が読まれ続けて実機では切り替わらない。
   *
   * 切り分けのための入切は残してある——効いていたのかどうかが実機の記録から確かめられて
   * いないため（`./mic-stream` の「マイクの接続を保った」が記録に写っていない）。
   */
  holdMicOptIn: boolean;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  continuous: true,
  speak: true,
  voiceURI: null,
  rate: RATE_DEFAULT,
  engineUrl: "",
  holdMicOptIn: false,
};

/**
 * 保存されていた声を読む。
 *
 * VOICEVOXの話者は、一覧から消したIDが端末に残っていることがある。そのまま使うと合成が
 * 毎回失敗して端末の声へ落ち続けるので、知らないIDならおまかせに戻す。
 */
function readVoiceURI(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith(VOICEVOX_PREFIX)) return parseVoicevoxSpeaker(value) ? value : null;
  return value;
}

function read(): VoiceSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_SETTINGS;

    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    return {
      continuous: parsed.continuous ?? DEFAULT_VOICE_SETTINGS.continuous,
      speak: parsed.speak ?? DEFAULT_VOICE_SETTINGS.speak,
      voiceURI: readVoiceURI(parsed.voiceURI),
      rate:
        typeof parsed.rate === "number" && parsed.rate >= RATE_MIN && parsed.rate <= RATE_MAX
          ? parsed.rate
          : DEFAULT_VOICE_SETTINGS.rate,
      engineUrl:
        typeof parsed.engineUrl === "string" ? parsed.engineUrl : DEFAULT_VOICE_SETTINGS.engineUrl,
      holdMicOptIn: parsed.holdMicOptIn ?? DEFAULT_VOICE_SETTINGS.holdMicOptIn,
    };
  } catch {
    // 壊れた値が残っていても画面は開けるようにする。
    return DEFAULT_VOICE_SETTINGS;
  }
}

/*
 * 読み込みと購読をReactの外に置く。
 *
 * localStorageはサーバー側の描画では読めないため、useStateの初期値にすると
 * ハイドレーションで食い違う。useEffectで入れ直すのも「効果の中でsetState」になる。
 * 外部ストアとして扱い、サーバー側では既定値、クライアントでは保存値を返す。
 */
let snapshot: VoiceSettings | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): VoiceSettings {
  snapshot ??= read();
  return snapshot;
}

function getServerSnapshot(): VoiceSettings {
  return DEFAULT_VOICE_SETTINGS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateVoiceSettings(patch: Partial<VoiceSettings>): void {
  snapshot = { ...getSnapshot(), ...patch };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // プライベートブラウズ等で保存できないことがある。その回だけ効けばよい。
  }

  for (const listener of listeners) listener();
}

export function useVoiceSettings(): VoiceSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Reactの外から、いまこの端末に入っている設定を読む（#205）。
 *
 * **`useVoiceSettings()` の値をマウント直後の効果から見てはいけない。** ハイドレーションの
 * あいだは `getServerSnapshot()`（＝既定値）が返るため、`useEffect(..., [])` の時点では
 * **保存されている値ではなく既定値**が読める（実測で、`holdMicOptIn` を入にしてある端末でも
 * 「切」と記録された）。「いま端末に入っている値」がほしい場面ではこちらを使う。
 */
export function voiceSettingsSnapshot(): VoiceSettings {
  return getSnapshot();
}

/** 購読するものが無い値のための、何もしない購読。 */
function subscribeNothing(): () => void {
  return () => {};
}

/**
 * この端末で聞き取りが使えるか。
 *
 * サーバー側では判定できないので、最初の描画では「使える」として出す。逆にすると、
 * 対応している端末でも一瞬だけ「使えません」の案内が出る。
 */
export function useRecognitionSupported(): boolean {
  return useSyncExternalStore(subscribeNothing, isSpeechRecognitionSupported, () => true);
}
