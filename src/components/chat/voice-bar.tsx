"use client";

import { Mic, Repeat, Settings2, Square } from "lucide-react";
import { useCallback, useState } from "react";

import { STATUS_LABEL } from "@/components/voice/speech-bubble";
import type { VoiceConversation } from "@/components/voice/use-voice-conversation";
import { VoiceSettingsPanel } from "@/components/voice/voice-settings-panel";
import { updateVoiceSettings, useVoiceSettings } from "@/lib/speech/voice-settings";
import { cn } from "@/lib/utils";

type Props = {
  /** 往復そのもの（`useVoiceConversation()`）。持ち主は「書く」画面。 */
  voice: VoiceConversation;
  /** 声をやめて入力欄へ戻る。 */
  onClose: () => void;
};

/**
 * 「書く」画面の下に出る音声バー（#279）。
 *
 * **「話す」の全画面（立ち絵）と同じ往復を、入力欄の場所で行うためのもの。** 記録の流れは
 * 後ろにそのまま残るので、声で話した内容も返事も、そのまま同じ並びへ積まれていく。
 *
 * ここは見た目だけで、聞き取り・読み上げ・開き直しは `useVoiceConversation()` が持つ
 * （#155・#164・#179・#197・#205・#210の手当てはすべてそちら）。
 *
 * - **状態の文言は吹き出し（#93）と同じ表**（`STATUS_LABEL`）。同じ往復の同じ状態を、画面に
 *   よって違う言い方で出さない
 * - **`aria-live="polite"` は状態の行に置く。** 声で話している利用者は画面を見ていないことが
 *   あるので、読み上げソフトが状態の変化をそのまま読めるようにする
 * - **「やめる」を必ず出す。** 聞き取りが開いたまま待つ場面（`no-speech` の開き直し）でも、
 *   入力欄へ戻る手が画面から消えないようにする
 * - **声の設定（`VoiceSettingsPanel`）はここからも開く。** 読み上げの声・「続けて話す」・
 *   VOICEVOX ENGINE、そして**聞き取りの記録**（#164・#179・#210）は「話す」画面の中にしか
 *   無かったが、既定が「書く」になった以上、この画面から開けないと届かない
 */
export function VoiceBar({ voice, onClose }: Props) {
  const settings = useVoiceSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `VoiceSettingsPanel` は `memo` で包んである（#228）。描画のたびに関数を作ると外れる。
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const { status, heard, hint, notice, error } = voice;

  const listening = status === "listening";

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {settingsOpen && (
        /*
          入力欄の上へ重ねる。**高さの上限と中のスクロールを必ず付ける**（#179）——付けずに
          いた結果、VOICEVOXの声を選んでいるiPhoneでは下端（＝聞き取りの記録）が画面外へ出て
          一度も読めなかった。基準は画面（`100dvh`）ではなく、ここから上に残る高さにする。
        */
        <VoiceSettingsPanel
          className="absolute bottom-full right-0 z-20 mb-2 max-h-[min(60dvh,26rem)] w-[min(320px,100%)]"
          onPrime={voice.prime}
          onNotice={voice.setNotice}
          onClose={closeSettings}
        />
      )}

      <div className="flex flex-col gap-3 rounded-[18px] border border-accent/45 bg-surface px-4 py-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              "mt-[0.4rem] size-2.5 shrink-0 rounded-full",
              listening ? "animate-pulse bg-accent" : "bg-border",
            )}
          />

          <p aria-live="polite" className="min-w-0 flex-1 text-sm leading-relaxed">
            {listening ? (
              heard === "" ? (
                <span className="text-muted">お話しください…</span>
              ) : (
                heard
              )
            ) : (
              <span className="text-muted">{STATUS_LABEL[status]}</span>
            )}
          </p>

          {/* 読み終えたあと自動でまたマイクを開くか（#67）。声の設定と同じ値を触る。 */}
          <button
            type="button"
            onClick={() => updateVoiceSettings({ continuous: !settings.continuous })}
            aria-pressed={settings.continuous}
            className={cn(
              "flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors",
              settings.continuous
                ? "border-transparent bg-accent-surface text-accent"
                : "border-border bg-background text-muted",
            )}
          >
            <Repeat className="size-3" aria-hidden="true" />
            続けて話す
          </button>

          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
            className="grid size-7 shrink-0 place-items-center rounded-lg border border-border bg-background text-muted transition-colors hover:bg-rail-active"
          >
            <Settings2 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">声の設定</span>
          </button>
        </div>

        <div className="flex items-center gap-2.5">
          {/*
            応答中もマイクのまま出す（#48）。押すと読み上げを止めて、そのまま聞き取りへ入る。
            四角に変えるのは聞き取り中だけ——そこでの役割は「話し終わった」の合図のため。
          */}
          <button
            type="button"
            onClick={voice.pressPrimary}
            disabled={!voice.supported && status !== "listening"}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40",
              voice.showStop
                ? "border border-border bg-background text-foreground"
                : "bg-accent text-accent-foreground",
            )}
          >
            {voice.showStop ? (
              <Square className="size-3.5 shrink-0 fill-current" aria-hidden="true" />
            ) : (
              <Mic className="size-4 shrink-0" aria-hidden="true" />
            )}
            {voice.primaryLabel}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full border border-border bg-background px-4 py-2.5 text-sm text-muted transition-colors hover:bg-rail-active"
          >
            やめる
          </button>
        </div>
      </div>

      {/* 聞き取りの案内（#155・#197）・読み上げの案内（VOICEVOXが使えなかった等）・失敗。 */}
      {hint && <p className="mt-2 text-center text-[0.6875rem] text-muted">{hint}</p>}
      {notice && <p className="mt-2 text-center text-[0.6875rem] text-muted">{notice}</p>}
      {error && (
        <p role="alert" className="mt-2 text-center text-[0.6875rem] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
