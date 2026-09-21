"use client";

import { Keyboard, Mic, Repeat, Settings2, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useTalkMode } from "@/components/chat/talk-mode-context";
import type { ChatEntry } from "@/components/chat/types";
import { useLocalEntries } from "@/components/chat/use-local-entries";
import { useThrottledText } from "@/components/chat/use-throttled-text";
import { noteRecognition } from "@/lib/speech/recognition";
import {
  updateVoiceSettings,
  useVoiceSettings,
  voiceSettingsSnapshot,
} from "@/lib/speech/voice-settings";
import { cn } from "@/lib/utils";

import { Robot } from "./robot";
import { SpeechBubble } from "./speech-bubble";
import { TodayLog } from "./today-log";
import { useBubbleLine } from "./use-notice";
import { isStandalone, useVoiceConversation } from "./use-voice-conversation";
import { VoiceSettingsPanel } from "./voice-settings-panel";

type Props = {
  /** サーバー側で確定させた今日の日付（`2026-09-03`）。日付の区切りに使う（#157）。 */
  todayKey: string;
  /** 発言と、書き込みの道具を使った記録（#81）を時刻順に混ぜたもの。 */
  initialEntries: ChatEntry[];
};

/**
 * 音声で秘書と対話する画面（#27）。
 *
 * **往復そのもの（聞き取り・送信・読み上げ・開き直し）は `useVoiceConversation()` が持つ**
 * （#279で切り出した。`./use-voice-conversation.ts`）。この画面が受け持つのは、ロボット・
 * 吹き出し・声の設定・今日の記録という**見た目の側だけ**で、同じフックを「書く」画面の
 * 音声バー（`@/components/chat/voice-bar`）も使う。**iOSの実機でしか出ない不具合の手当ては
 * すべてフック側にある**ので、聞き取りの振る舞いを変えるときはそちらを読むこと。
 *
 * 返答の生成は「書く」と同じ `POST /api/chat`。声で話した内容も同じ連続セッションへ残るため、
 * 「書く」に切り替えれば文字で読み返せる。
 *
 * **聞き取りの途中経過（interim）や返答の差分のたびに描き直されるのは、この画面の骨組みだけに
 * する**（#228）。ロボット（`Robot`）・吹き出し（`SpeechBubble`）・声の設定・今日の記録
 * （`TodayLog`）は `memo` で包み、props が変わったときだけ描く。**そのため、これらへ渡す
 * 関数は `useCallback` などで参照を保つこと**——描画のたびに作る関数を渡すと `memo` が外れる。
 * 返答の差分は `useThrottledText()` で60msに1回へ間引いている（「書く」と共通）。
 *
 * **この画面は送信の前後で一度もルートをまたがない（#157）。** #67・#155で手当てして
 * いた「新しい相談の1通目で `/c/<ID>` へ移る」経路は、書き込み先が利用者につき1本の
 * 連続セッションになったことで消えた。
 */
export function VoicePanel({ initialEntries, todayKey }: Props) {
  const { setMode } = useTalkMode();

  const { entries, addUser, addAssistant, addRecord } = useLocalEntries(initialEntries);
  // 直前に話した内容と、いま届いている返答。記録（`entries`）とは別に、大きな字でも出す。
  const [lastUser, setLastUser] = useState<string | null>(null);
  const { text: reply, set: setReplyText, flush: flushReply, reset: resetReply } = useThrottledText();

  const voice = useVoiceConversation({
    onUserMessage: (text) => {
      setLastUser(text);
      resetReply();
      addUser(text);
    },
    onReply: setReplyText,
    // 声だけでは「何を登録したのか」がその場で流れて消える。右の記録欄へ残す（#81）。
    onRecord: addRecord,
    onAssistantMessage: (message) => {
      addAssistant(message);
      // 返答は確定後も大きな字で残す。間引きに残った最後の差分をここで反映しておく。
      flushReply();
    },
  });

  const {
    status,
    heard,
    hint,
    notice,
    error,
    activity,
    reacting,
    answering,
    showStop,
    primaryLabel,
    supported,
    setNotice,
  } = voice;

  // 待っている間、吹き出しに出す1枠（#93・#101）。お知らせ・ひとりごと・呼びかけを順に回す。
  // 変数名を `notice` にしないのは、上の `notice`（VOICEVOXが使えなかった等の案内）と別物のため。
  const bubbleLine = useBubbleLine();

  const settings = useVoiceSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // `VoiceSettingsPanel` は `memo` で包んである。描画のたびに関数を作ると外れる。
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  /*
   * 記録の1行目に前提を残す（#205）。
   *
   * **この画面の症状はホーム画面のPWAでしか出ない**（同じiPhoneでもSafariのタブでは続けて
   * 話せる。#179の切り分け）のに、報告された記録からはどちらで開いたのかも、「マイクの接続を
   * 保つ」が入だったのかも読めなかった。開いた時点で1行だけ残しておけば、貼られた記録が
   * そのまま切り分けの材料になる。
   */
  useEffect(() => {
    const where = isStandalone() ? "ホーム画面のPWA" : "ブラウザのタブ";
    // 設定は `useVoiceSettings()` ではなく直接読む。ハイドレーションのあいだは既定値が返る。
    const hold = voiceSettingsSnapshot().holdMicOptIn ? "入" : "切";
    noteRecognition(`画面を開いた（${where}・接続を保つ:${hold}）`);
  }, []);

  /*
   * 「止める」と中央のボタンは、いまはフックへそのまま渡す（#279）。鳴っている試し聞きを
   * 止めるのは `cancelSample()`（`@/lib/speech/synthesis`）の仕事で、フックの `prime()` と
   * `stop()` が呼ぶ——声の設定はどの画面からも開けるようになったので、画面ごとに
   * 「押したら試し聞きを止める」を書くと、足し忘れた画面だけ鳴りっぱなしになる。
   */
  const stopNow = voice.stop;
  const onPrimaryButton = voice.pressPrimary;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          aria-expanded={settingsOpen}
          className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-[10px] border border-border bg-background text-muted transition-colors hover:bg-rail-active md:right-6 md:top-4"
        >
          <Settings2 className="size-4" aria-hidden="true" />
          <span className="sr-only">声の設定</span>
        </button>

        {settingsOpen && (
          /*
            縦に長くなったぶんはパネルの中でスクロールさせる（#179）。高さの上限を置かずに
            いた結果、VOICEVOXの声を選んでいるiPhoneでは下端（＝聞き取りの記録）が画面外へ
            出て**一度も読めなかった**——#164で入れた唯一の手掛かりが使えていなかった。
            上限は画面ではなくこの入れ物（`relative` な親）を基準にする。上の余白（`top-14`）と
            下に残す1remを引けば、ヘッダーの高さを当てにせずに収まる。
          */
          <VoiceSettingsPanel
            className="absolute right-3 top-14 z-20 max-h-[calc(100%-4.5rem)] w-[min(320px,calc(100%-1.5rem))] md:right-6 md:top-16 md:max-h-[calc(100%-5rem)]"
            onPrime={voice.prime}
            onNotice={setNotice}
            onClose={closeSettings}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto overscroll-contain px-6 py-6 text-center">
          {/*
            hint・notice・error・「聞き取りに対応していません」の案内が重なると、
            ロボット・吹き出し・返答文だけでも狭い画面の高さを超える（#191）。ページ全体を
            固定した以上、ここで縮めきれないぶんの逃げ場をこの列自身が持つ必要がある
            ——持たないと、ページスクロールで逃がしていたはみ出しがただ読めなくなるだけになる。
          */}
          {/* 待っている間は積まれたお知らせを、往復中はいまの状態を、同じ吹き出しで出す
              （#93）。外部サービスを見に行っている間に理由を出す扱い（#46）もここへ移した。 */}
          <SpeechBubble state={status} line={bubbleLine} activity={activity} />

          <Robot
            state={status}
            reacting={reacting}
            className="size-[168px] md:size-[184px] lg:size-[200px]"
          />

          <div className="flex w-full max-w-[36rem] flex-col gap-3">
            {status === "listening" ? (
              <p className="min-h-[3.5rem] text-lg leading-relaxed font-medium">
                {heard === "" ? (
                  <span className="text-muted">お話しください…</span>
                ) : (
                  heard
                )}
              </p>
            ) : (
              <>
                {lastUser && (
                  <p className="text-xs text-muted">
                    さっき話したこと — <span className="font-medium text-foreground">「{lastUser}」</span>
                  </p>
                )}
                <p className="min-h-[3.5rem] whitespace-pre-wrap text-lg leading-relaxed font-medium">
                  {reply !== "" ? (
                    reply
                  ) : status === "thinking" ? (
                    <span className="text-muted">
                      {activity ? `${activity.server}を調べています…` : "返事を考えています…"}
                    </span>
                  ) : entries.length === 0 ? (
                    <span className="text-muted">
                      下のマイクを押して、そのまま話しかけてください。
                    </span>
                  ) : (
                    <span className="text-muted">続けて話しかけてください。</span>
                  )}
                </p>
              </>
            )}

            {answering && (
              <div className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={stopNow}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted transition-colors hover:bg-rail-active"
                >
                  <Square className="size-2.5 fill-current" aria-hidden="true" />
                  {status === "thinking" ? "生成を止める" : "読み上げを止める"}
                </button>
                <p className="text-[0.6875rem] text-muted">
                  下のマイクを押すと、途中で割り込んで話しかけられます。
                </p>
              </div>
            )}

            {!supported && (
              <p
                role="alert"
                className="rounded-xl border border-border bg-surface px-4 py-3 text-sm leading-relaxed text-muted"
              >
                このブラウザでは聞き取りが使えません。
                <button
                  type="button"
                  onClick={() => setMode("write")}
                  className="mx-1 underline underline-offset-2 hover:text-foreground"
                >
                  「書く」に切り替える
                </button>
                と、文字で相談できます。
              </p>
            )}

            {hint && (
              <p className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
                {hint}
              </p>
            )}

            {notice && (
              <p className="rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-muted">
                {notice}
              </p>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-xl border border-danger/30 bg-danger-surface px-4 py-2.5 text-sm text-danger"
              >
                {error}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 border-t border-border bg-surface px-6 pb-6 pt-4 md:gap-8">
          <button
            type="button"
            onClick={() => updateVoiceSettings({ continuous: !settings.continuous })}
            aria-pressed={settings.continuous}
            className="flex w-[4.5rem] flex-col items-center gap-1.5 text-[0.6875rem] text-muted"
          >
            <span
              className={cn(
                "grid size-11 place-items-center rounded-[13px] border transition-colors",
                settings.continuous
                  ? "border-transparent bg-accent-surface text-accent"
                  : "border-border bg-background text-foreground",
              )}
            >
              <Repeat className="size-[18px]" aria-hidden="true" />
            </span>
            続けて話す
          </button>

          {/*
            応答中もマイクのまま出す（#48）。押すと読み上げを止めて、そのまま聞き取りへ入る。
            四角に変えるのは聞き取り中だけ——そこでの役割は「話し終わった」の合図のため。
          */}
          <button
            type="button"
            onClick={onPrimaryButton}
            disabled={!supported && status !== "listening"}
            className={cn(
              "grid size-[76px] place-items-center rounded-full transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40",
              showStop
                ? "border border-border bg-surface text-foreground"
                : "bg-accent text-accent-foreground shadow-[0_0_0_8px_color-mix(in_oklab,var(--accent)_16%,transparent)]",
            )}
          >
            {showStop ? (
              <Square className="size-6 fill-current" aria-hidden="true" />
            ) : (
              <Mic className="size-7" aria-hidden="true" />
            )}
            <span className="sr-only">{primaryLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopNow();
              setMode("write");
            }}
            className="flex w-[4.5rem] flex-col items-center gap-1.5 text-[0.6875rem] text-muted"
          >
            <span className="grid size-11 place-items-center rounded-[13px] border border-border bg-background text-foreground">
              <Keyboard className="size-[18px]" aria-hidden="true" />
            </span>
            文字で送る
          </button>
        </div>
      </div>

      {/* 画面が広いときだけ、いまの相談のやり取りを右へ添える。声だけだと直前しか追えない。 */}
      <TodayLog entries={entries} todayKey={todayKey} speak={settings.speak} />
    </div>
  );
}
