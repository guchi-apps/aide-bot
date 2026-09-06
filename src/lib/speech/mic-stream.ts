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
 * 声の設定から入切できるようにしてある（`VoiceSettings.holdMic`）。逆に聞き取りが壊れる
 * 可能性もゼロではないので、実機でその場に切り戻せることを優先した。
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
 * **利用者が押した流れの中から呼ぶこと。** 初回は許可を尋ねる確認が出るため、操作の外から
 * 呼ぶと黙って断られる。失敗しても投げない——接続を取れなくても、聞き取りそのものは
 * 今までどおり動く（この対策が効かないだけ）。
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
      // 端末側の都合で切れることがある。切れたら手放しておき、次に押したときに取り直す。
      for (const track of stream.getTracks()) {
        track.addEventListener("ended", () => {
          if (held === stream) releaseMicStream();
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

/** 保っている接続を手放す。画面を離れるとき・設定を切ったとき。 */
export function releaseMicStream(): void {
  generation += 1;
  acquiring = false;

  const stream = held;
  held = null;
  if (!stream) return;

  stopTracks(stream);
  noteRecognition("マイクの接続を手放した");
}
