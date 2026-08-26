/**
 * Web Pushの鍵まわり（#79）。**サーバー専用。**
 *
 * VAPIDは「この送信元が本当にそのアプリか」をブラウザベンダーのPushサービスに示すための
 * 鍵ペアで、公開鍵・秘密鍵の2つを環境変数で受け取る。
 *
 * ## 公開鍵を `NEXT_PUBLIC_*` に置かない理由
 *
 * 公開鍵はクライアントの `pushManager.subscribe()` に渡す必要があり、**本来は公開して
 * よい値**なので、VOICEVOX ENGINEのURLを `NEXT_PUBLIC_*` から外した判断（#57。tailnetの
 * ホスト名が誰にでも読めてしまうため）とは前提が違う。それでもここへ置かないのは、
 * ビルド時に埋め込む必要がまったく無いためで、機密性のためではない。
 *
 * - `NEXT_PUBLIC_*` はビルド時にバンドルへ焼き込まれるので、**鍵を差し替えるたびに
 *   再ビルドが要る**（`.env` を書き換えて再起動するだけでは効かない）
 * - 値を使うのは設定の画面1枚だけで、そこはサーバーコンポーネント。propsで渡せば足りる
 * - ログイン前のページに配らずに済む（実害は無いが、配る理由も無い）
 */

/**
 * VAPIDの `subject`。仕様上 `mailto:` かURLで、送信が拒否されたときの連絡先の意味しかない。
 * 資格情報ではないので環境変数にせず、ここに直接持つ。
 */
export const VAPID_SUBJECT = "https://aide-bot.gucchii.com/";

/** ブラウザへ渡す公開鍵。未設定なら空文字。 */
export function pushPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** 署名に使う秘密鍵。**画面へもログへも出さないこと。** */
export function pushPrivateKey(): string {
  return process.env.VAPID_PRIVATE_KEY ?? "";
}

/**
 * 通知を配れる状態か。
 *
 * 鍵が片方でも欠けていたら通知の導線ごと出さない。片方だけで購読させると、購読は
 * できたのに送信が必ず失敗する——「登録したのに何も来ない」がいちばん分かりにくい。
 */
export function isPushConfigured(): boolean {
  return pushPublicKey() !== "" && pushPrivateKey() !== "";
}
