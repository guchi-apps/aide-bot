/**
 * マイクの接続（`getUserMedia` の `MediaStream`）を、往復のあいだ保ち続ける（#179）。
 *
 * **聞き取りそのものはこのストリームを使わない。** 音を読むのは今までどおり Web Speech API で、
 * ここで取るのは「マイクを掴んだままにしておく」ためだけの接続。
 *
 * iPhoneのホーム画面PWA（standalone）で、1往復目の読み上げが終わったあとに自動で開いた
 * マイクが音を拾わなくなる、という症状（#179）の対策。実機での切り分けで分かったことは3つ。
 *
 * - **マイクのボタンを手で押し直しても復帰しない。** ユーザー操作の外で `start()` を
 *   呼んでいることが原因（transient activationの期限切れ）なら、押し直せば通るはずだった
 * - **iPhoneでもSafariのタブでは正常に続けて話せる。** standalone固有の制約に絞れる
 * - 読み上げはVOICEVOX（`<audio>` 要素での再生）だった
 *
 * 残るのは「一度なにかを鳴らすと、iOS側の音声の扱いが再生側のまま固着し、以降マイクへ音が
 * 回ってこない」という線。#164は鳴らしていたものを手放して間を置く（`silenceBeforeListening()`
 * ＋400ms）形で外そうとしたが、届かなかった。手放す代わりに**録音を含む扱いのまま握り続ける**
 * のがここでやること——接続を保っているあいだは、再生側の扱いへ落ちる余地がない。
 *
 * **効いたかどうかは手元（サブPC）では確かめられない。** iPhoneのPWAでしか再現しないため、
 * 声の設定から入切できるようにしてある（`VoiceSettings.holdMicOptIn`）。逆に聞き取りが壊れる
 * 可能性もゼロではないので、実機でその場に切り戻せることを優先した。
 *
 * **取る順序は「聞き取りを開いてから」に固定してある（#210）。** #205・#210の実機の記録を
 * 合わせると、**開いた時点で接続をすでに保っていた聞き取りは5回とも声が届かず**（黙ったまま
 * 15秒・`aborted`・`audio-capture`）、**開いた後に接続を取った聞き取りは3回とも届いた**。
 * 呼ぶ側（`VoicePanel.beginListening()`）は開く前に `releaseMicStream()` で必ず手放し、
 * `start()` が通ってから `holdMicStream()` で取り直す。順序を崩さないこと。
 */

import { noteRecognition } from "./recognition";

/** いま保っている接続。無ければ `null`。 */
let held: MediaStream | null = null;

/** 取得の最中か。押すたびに二重に取りに行かないための印。 */
let acquiring = false;

/**
 * 取得の世代。
 *
 * 取得は非同期なので、待っているあいだに手放し（画面を離れた・設定を切った）が来ることがある。
 * 世代が変わっていたら、届いた接続はその場で捨てる——捨てないと、離れた画面のためにマイクを
 * 掴んだままになる。
 */
let generation = 0;

function isSupported(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * マイクの接続を取って保つ。すでに保っていれば何もしない。
 *
 * **聞き取りの `start()` が通った直後に呼ぶこと（#210）。** 初回は許可を尋ねる確認が出るため、
 * 初回だけは利用者が押した流れの中にある必要がある——押して開いた回は `start()` と同じ
 * 同期の流れの中で呼ばれるのでそのまま通る。読み上げのあと自動で開いた回は操作の外だが、
 * 同じ画面で一度許可されていれば取り直せる。取れなかった回は記録に残る。失敗しても投げない
 * ——接続を取れなくても、聞き取りそのものは今までどおり動く（この対策が効かないだけ）。
 */
export function holdMicStream(): void {
  if (!isSupported() || held || acquiring) return;

  acquiring = true;
  const session = generation;

  void navigator.mediaDevices.getUserMedia({ audio: true }).then(
    (stream) => {
      acquiring = false;

      // 待っているあいだに手放しが来ていた。掴んだままにしない。
      if (session !== generation) {
        stopTracks(stream);
        return;
      }

      held = stream;
      /*
       * 端末側の都合で切れることがある。切れたら手放しておき、次に開いたときに取り直す。
       * **「手放した」とは別の行で記録する**（#210）。#205の記録には読み上げの最中に
       * 「手放した」が1行あり、利用者が止めたのか端末が切ったのかを読み分けられなかった。
       */
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", () => {
          if (held !== stream) return;
          drop();
          noteRecognition("マイクの接続が端末側で切れた");
        });
      }
      noteRecognition("マイクの接続を保った");
    },
    () => {
      acquiring = false;
      // 許可されていない・マイクが無い。どちらも聞き取り側で同じ理由の文言が出る。
      noteRecognition("マイクの接続を取れなかった");
    },
  );
}

/**
 * いま接続を保っているか（#205）。
 *
 * **記録に「マイクを開いた時点で接続を保っていたか」を残すために足した。** #197は「掴んだ
 * 接続が聞き取りと録音を取り合っているのではないか」を疑って既定を切にしたが、記録からは
 * その回に保っていたかどうかが読めない——`holdMicStream()` は保っていればそのまま戻る
 * （＝何も記録しない）ので、「保った」の行が出るのは取り直した回だけになる。
 */
export function isMicStreamHeld(): boolean {
  return held !== null;
}

/** 保っている接続を捨てる。取得の途中なら、届いたぶんも捨てさせる。手放していれば `false`。 */
function drop(): boolean {
  generation += 1;
  acquiring = false;

  const stream = held;
  held = null;
  if (!stream) return false;

  stopTracks(stream);
  return true;
}

/**
 * 保っている接続を手放す。聞き取りを開く前・画面を離れるとき・設定を切ったとき。
 *
 * 何も保っていなければ記録にも残さない——開く前に毎回呼ぶ（#210）ので、既定（切）の端末で
 * 往復ごとに「手放した」が並ぶことになる。
 */
export function releaseMicStream(): void {
  if (drop()) noteRecognition("マイクの接続を手放した");
}
