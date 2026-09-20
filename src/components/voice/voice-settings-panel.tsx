"use client";

import { Copy, Play, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { releaseMicStream } from "@/lib/speech/mic-stream";
import { recognitionLog, subscribeRecognitionLog } from "@/lib/speech/recognition";
import {
  RATE_MAX,
  RATE_MIN,
  type Reader,
  canSpeakWith,
  cancelSample,
  speakSample,
  watchJapaneseVoices,
} from "@/lib/speech/synthesis";
import { updateVoiceSettings, useVoiceSettings } from "@/lib/speech/voice-settings";
import {
  VOICEVOX_SPEAKERS,
  type EngineCheck,
  checkVoicevoxEngine,
  normalizeEngineUrl,
  parseVoicevoxSpeaker,
  voicevoxVoiceURI,
} from "@/lib/speech/voicevox";
import { cn } from "@/lib/utils";

type Props = {
  /** 入れ物の置き方。画面ごとに出る場所が違うので、位置は持ち主が決める。 */
  className?: string;
  /**
   * iOSの許可取り（`useVoiceConversation()` の `prime()`）。
   *
   * 試し聞きを押した操作を、そのまま以降の読み上げの許可として使う。**押した流れの中で
   * 呼ぶ必要がある**ので、パネルの中で勝手に作らず持ち主から渡してもらう。
   */
  onPrime: () => void;
  /** 読み上げの案内欄（VOICEVOXが使えず端末の声で読んだ、など）。往復の側と同じ欄へ出す。 */
  onNotice: (value: string | null) => void;
  onClose: () => void;
};

/**
 * 声の設定（#279で `voice-panel.tsx` から切り出した）。
 *
 * **「話す」の全画面と「書く」画面の音声バーの両方から、同じものを開く。** #279で既定が
 * 「書く」になったので、ここに置いてある「続けて話す」「読み上げる声」「VOICEVOX ENGINE」
 * そして**聞き取りの記録（#164・#179・#210）**が、既定の画面から開けないと困る——記録は
 * iOSの実機でしか出ない不具合を追う唯一の手掛かりで、音声バーで往復するほど必要になる。
 *
 * 値の持ち主は `@/lib/speech/voice-settings`（端末ごとのlocalStorage）なので、どちらから
 * 開いても同じ設定を触る。
 */
export function VoiceSettingsPanel({ className, onPrime, onNotice, onClose }: Props) {
  const settings = useVoiceSettings();
  // 聞き取りの節目の記録（#164）。iOSの実機でしか起きない不具合を、画面から報告できるようにする。
  const recognitionEvents = useSyncExternalStore(
    subscribeRecognitionLog,
    recognitionLog,
    recognitionLog,
  );
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  // 試し聞きの合成待ち。VOICEVOXは数秒かかるので、押しても無反応に見えないようにする（#52）。
  const [samplePreparing, setSamplePreparing] = useState(false);
  // 自前のVOICEVOX ENGINEへの疎通確認（#57）。
  const [engineCheck, setEngineCheck] = useState<EngineCheck | null>(null);
  const [engineChecking, setEngineChecking] = useState(false);
  // 聞き取りの記録をコピーしたことの合図（#179）。実機の記録をそのまま報告してもらうため。
  const [logCopied, setLogCopied] = useState(false);

  const sampleRef = useRef<Reader | null>(null);

  // 選べる声は端末が非同期に用意する。揃った時点で入れ直す。
  useEffect(() => watchJapaneseVoices(setVoices), []);

  // 閉じたら鳴らしっぱなしにしない。往復の側から止めたいときは `cancelSample()`（#279）。
  useEffect(() => {
    return () => {
      sampleRef.current?.cancel();
      sampleRef.current = null;
    };
  }, []);

  /** 選んでいる声で1文だけ鳴らす。押した操作をiOSの許可としても使う。 */
  function onSample() {
    onPrime();
    onNotice(null);
    cancelSample();
    setSamplePreparing(false);
    sampleRef.current = speakSample(settings.voiceURI, settings.rate, {
      engineUrl: settings.engineUrl,
      onPreparing: () => setSamplePreparing(true),
      onDone: () => setSamplePreparing(false),
      onNotice: onNotice,
    });
  }

  /**
   * 聞き取りの記録を丸ごとコピーする（#179）。
   *
   * この記録はiPhoneでしか起きない不具合を追うための唯一の手掛かりなのに、読み上げるか
   * 書き写すしか報告する手が無かった。失敗しても黙って戻す——記録そのものは画面から読める。
   */
  async function onCopyLog() {
    const text = recognitionEvents.map((entry) => `${entry.at} ${entry.text}`).join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setLogCopied(true);
      setTimeout(() => setLogCopied(false), 2_000);
    } catch {
      // クリップボードが使えない端末・文脈がある。
    }
  }

  /** 入力したENGINEのURLへ実際に届くかを確かめる。 */
  async function onCheckEngine() {
    setEngineChecking(true);
    setEngineCheck(await checkVoicevoxEngine(settings.engineUrl));
    setEngineChecking(false);
  }

  const speakable = canSpeakWith(settings.voiceURI);
  const voicevoxSpeaker = parseVoicevoxSpeaker(settings.voiceURI);
  const engineConfigured = normalizeEngineUrl(settings.engineUrl) !== null;

  return (
    <div className={cn("overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-4 shadow-xl", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium">声の設定</h2>
        <button
          type="button"
          onClick={onClose}
          className="grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-rail-active"
        >
          <X className="size-3.5" aria-hidden="true" />
          <span className="sr-only">閉じる</span>
        </button>
      </div>

      <label className="flex items-center justify-between gap-3 py-2 text-sm">
        返事を読み上げる
        <input
          type="checkbox"
          checked={settings.speak}
          onChange={(event) => updateVoiceSettings({ speak: event.target.checked })}
          className="size-4 accent-accent"
        />
      </label>

      <label className="flex items-center justify-between gap-3 py-2 text-sm">
        続けて話す
        <input
          type="checkbox"
          checked={settings.continuous}
          onChange={(event) => updateVoiceSettings({ continuous: event.target.checked })}
          className="size-4 accent-accent"
        />
      </label>

      {/*
        iPhoneのホーム画面PWAで、読み上げのあとにマイクが音を拾わなくなる症状の対策
        （#179）。**既定は切**——入のまま出した#179の後で、2往復目以降が端末に中断
        されるという報告になった（#197）。#210で「開いた後に取る」順序に固定したが、
        効くかどうかはまだ実機の記録でしか分からないので、切り分けのために入切は残す。
        **入にした時点では取らない**——次に聞き取りを開いたときに `start()` の後で取る。
        ここで取ると、次の聞き取りが「保ったまま開く」順になる。
      */}
      <label className="flex items-center justify-between gap-3 py-2 text-sm">
        マイクの接続を保つ
        <input
          type="checkbox"
          checked={settings.holdMicOptIn}
          onChange={(event) => {
            const holdMicOptIn = event.target.checked;
            updateVoiceSettings({ holdMicOptIn });
            if (!holdMicOptIn) releaseMicStream();
          }}
          className="size-4 accent-accent"
        />
      </label>
      <p className="-mt-1 mb-1 text-xs leading-relaxed text-muted">
        聞き取りを開くたびに、マイクの接続をいったん手放してから開き、開けたあとで
        つなぎ直します。iPhoneのホーム画面から開いたときに2回目以降の声が届かない場合の
        切り分け用の項目で、入にしたときと切のときの両方の「聞き取りの記録」を見比べます。
      </p>

      <label className="flex flex-col gap-1.5 py-2 text-sm">
        声
        <select
          value={settings.voiceURI ?? ""}
          onChange={(event) => {
            sampleRef.current?.cancel();
            sampleRef.current = null;
            setSamplePreparing(false);
            onNotice(null);
            updateVoiceSettings({ voiceURI: event.target.value || null });
          }}
          className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="">端末におまかせ</option>
          <optgroup label="VOICEVOX（インターネット経由）">
            {VOICEVOX_SPEAKERS.map((speaker) => (
              <option key={speaker.id} value={voicevoxVoiceURI(speaker.id)}>
                {speaker.label}
              </option>
            ))}
          </optgroup>
          {voices.length > 0 && (
            <optgroup label="この端末の声">
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>

      <button
        type="button"
        onClick={onSample}
        disabled={!speakable || samplePreparing}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 text-sm transition-colors hover:bg-rail-active disabled:opacity-40"
      >
        <Play className="size-3.5" aria-hidden="true" />
        {samplePreparing ? "声を用意しています…" : "試し聞き"}
      </button>

      {voicevoxSpeaker && (
        <>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            {voicevoxSpeaker.credit}
            <br />
            {engineConfigured
              ? "下のVOICEVOX ENGINEで合成します。届かないときだけ、返事の文面がWEB版API（api.tts.quest）へ送られ、それも駄目ならこの端末の声で読み上げます。"
              : "返事の文面は、音声にするためVOICEVOXのWEB版API（api.tts.quest）へ送られます。合成に数秒かかるため、返事が出てから声が始まるまで少し間があきます。混み合っているときや通信できないときは、この端末の声で読み上げます。"}
          </p>

          <label className="flex flex-col gap-1.5 py-2 text-sm">
            VOICEVOX ENGINE のURL
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="https://<ホスト名>:50021"
              value={settings.engineUrl}
              onChange={(event) => {
                setEngineCheck(null);
                updateVoiceSettings({ engineUrl: event.target.value });
              }}
              className="rounded-lg border border-border bg-background px-2.5 py-2 text-sm outline-none focus:border-accent"
            />
            <span className="text-xs leading-relaxed text-muted">
              自分で動かしているENGINEがあれば入れてください。合成が速くなり、返事の文面が
              外へ出なくなります。この端末にだけ保存されます。
            </span>
          </label>

          <button
            type="button"
            onClick={() => void onCheckEngine()}
            disabled={!engineConfigured || engineChecking}
            className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm transition-colors hover:bg-rail-active disabled:opacity-40"
          >
            {engineChecking ? "確かめています…" : "接続を確かめる"}
          </button>

          {engineCheck && (
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {engineCheck.ok
                ? `つながりました（ENGINE ${engineCheck.version}）。`
                : engineCheck.message}
            </p>
          )}
        </>
      )}

      <label className="flex flex-col gap-1.5 py-2 text-sm">
        <span className="flex items-center justify-between">
          読み上げの速さ
          <span className="text-xs text-muted">{settings.rate.toFixed(1)}倍</span>
        </span>
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={0.1}
          value={settings.rate}
          onChange={(event) => updateVoiceSettings({ rate: Number(event.target.value) })}
          className="accent-accent"
        />
      </label>

      {!speakable && (
        <p className="mt-1 text-xs leading-relaxed text-muted">
          このブラウザは端末の声での読み上げに対応していません。VOICEVOXの声を選ぶと読み上げられます。
        </p>
      )}

      {/*
        聞き取りの節目の記録（#164）。iPhoneでしか起きない不具合は手元で再現できないため、
        「マイクを開いた」までは出ているのか・「声が届いた」が一度も無いのかを、その端末の
        画面から読めるようにしてある。開いた回が並ぶだけで声が届いていなければ、マイクは
        開いているのに音が回ってきていない。
      */}
      {recognitionEvents.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">聞き取りの記録</p>
            {/* 実機の記録をそのまま報告できるようにする（#179）。 */}
            <button
              type="button"
              onClick={() => void onCopyLog()}
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-1 text-[0.6875rem] text-muted transition-colors hover:bg-rail-active"
            >
              <Copy className="size-3" aria-hidden="true" />
              {logCopied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className="mt-1 text-[0.6875rem] leading-relaxed text-muted">
            うまく聞き取れないときに、何が起きていたかを見るための記録です。
          </p>
          <ul className="mt-1.5 max-h-32 space-y-0.5 overflow-y-auto text-[0.6875rem] leading-relaxed text-muted">
            {recognitionEvents.map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="flex gap-2">
                <span className="tabular-nums">{entry.at}</span>
                <span>{entry.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
