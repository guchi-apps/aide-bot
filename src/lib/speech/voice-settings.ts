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
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  continuous: true,
  speak: true,
  voiceURI: null,
  rate: RATE_DEFAULT,
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
