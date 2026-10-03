# Morrow iOSアプリ

本番Morrow（`https://aide-bot.gucchii.com/`）をiPhoneの独立したアプリとして開くための、SwiftUI + WKWebView の薄い殻です（#441）。
**画面・会話・履歴・AIDE連携はすべてWeb版（既存サーバー）が正本**で、ここには「Web版を開く・Googleログインを認証シートで往復させる・通信できないときに再試行させる」ことしか書いていません。Web/PWA版の挙動は変えていません。方式・署名・配布手順は YoteiFlow の `ios/` と同じ構成です。

| 項目 | 値 |
|---|---|
| 表示名 | Morrow |
| Bundle ID | `com.gucchii.morrow` |
| 署名 | Automatic（Apple Developer Program のチーム `6AA3WFTR94`。kurashio・YoteiFlow と同じチーム） |
| 対応 | iPhone・縦向き・iOS 18以上 |
| 認証シートの戻り先 | `morrow://auth-callback` |
| Associated Domains / Push / App Group | 使わない（初版スコープ外） |

## 更新が要る場所

| 変えたもの | Web/PWA | iOSアプリ |
|---|---|---|
| 画面・機能・会話・サーバー（`src/`） | mainへマージ → 自動デプロイ | 何もしなくてよい（次に開いたとき新しい画面が出る） |
| アプリの殻（`ios/`） | 影響なし | Xcodeで入れ直す／TestFlightへ新しいビルドを上げる |

## ビルド方法（Mac + Xcode）

**subpc には Xcode が無い**ため、ビルド・実機確認はMacで行います。

1. Xcode 27系を使う（`project.pbxproj` は `objectVersion = 110`。古いXcodeでは開けない）
2. `open ios/Morrow.xcodeproj`
3. スキーム `Morrow`・実行先を自分のiPhoneにし、Signing & Capabilities の Team が Apple Developer Program のチームになっていることを確かめて ⌘R
4. 初回は iPhone の 設定 → プライバシーとセキュリティ → デベロッパモード をオンにし、設定 → 一般 → VPNとデバイス管理 で開発者証明書を信頼する

## TestFlight で配布する

**ビルドとアップロードは Mac でしかできません。** TestFlight のビルドは90日で期限切れになるため、そのたびに新しいビルドを上げます。

| 項目 | 値・運用 |
|---|---|
| App Store Connect のアプリ | 名前 `Morrow`・Bundle ID `com.gucchii.morrow`・チーム `6AA3WFTR94`（初回だけ手作業） |
| 輸出コンプライアンス | `INFOPLIST_KEY_ITSAppUsesNonExemptEncryption = NO`（標準のHTTPS通信のみ） |
| アイコン | `AppIcon.appiconset` の1024px（アルファ無し）。`public/icon.svg`（承認済みのMマーク）から書き出したもの |
| 版番号（`MARKETING_VERSION`） | `package.json` の `version` と揃える。上げる前に `node ios/scripts/sync-version.mjs`（冪等）して差分をコミットする |
| ビルド番号（`CURRENT_PROJECT_VERSION`） | アップロードのたびに増える必要がある。スクリプトが Archive 時に日時（`YYYYMMDDHHMM`）で上書きする（`IOS_BUILD_NUMBER` で固定も可） |

### 初回だけ（手作業・本人の操作）

1. [App Store Connect](https://appstoreconnect.apple.com/) → マイApp → 「+」→ 新規App。プラットフォーム iOS・名前 Morrow・プライマリ言語 日本語・Bundle ID `com.gucchii.morrow`・SKU は任意（例 `morrow`）。Bundle ID が候補に出ない場合は Developer サイトの Identifiers で `com.gucchii.morrow` を先に登録する
2. App Store Connect API キーは**新しく作らず共用**する（APIキーはチーム単位）。1Password の `apps/MyRoom` の `asc-key-id`・`asc-issuer-id`・`asc-key-p8` を `ios/asc.env.tpl` が参照している
3. TestFlight →「内部テスト」にグループを作り、自分を追加
4. サーバー側の確認（下記「Supabase側の設定」）

### ビルドを上げるたび（subpc から1コマンド）

**Web側が main へデプロイされた後に**、`main` から上げます。

```bash
node ios/scripts/sync-version.mjs          # 版番号を package.json に揃える（差分があればコミットしてmainへ）
ios/scripts/remote-upload-testflight.sh    # Mac で main を取り込み、TestFlight へ上げる
```

- Mac 側の前提: チェックアウトが `$HOME/apps/morrow` にある（別の場所なら `MAC_REPO_DIR='$HOME/x'`）・Xcode・1Password CLI（`op`）にサインイン済み・ログインキーチェーンが開いている
- `MAC_HOST`（既定 `guchimac-mini`）・`MAC_REPO_DIR`・`IOS_BRANCH`・`IOS_SKIP_PULL=1`・`IOS_BUILD_NUMBER` を環境変数で上書きできる。作業ツリーに未コミットの変更があると中止する
- Mac の前にいるなら `op run --env-file=ios/asc.env.tpl -- ios/scripts/upload-testflight.sh`
- スクリプトは `check-consistency.mjs` → `xcodebuild archive` → `xcodebuild -exportArchive`（App Store Connect へ直接アップロード）を順に実行し、**どれかが失敗したらそこで止まる**。**終了コードをパイプで隠さないこと**（`| tee` 等を付けない）。成功と表示されるのはアップロードまで通った場合だけ
- **subpc からは実行結果を確かめられない**。初回は Mac で1回通して確かめる

## 開発環境と本番の切り替え

`Morrow/AppConfig.swift` の `baseURL` だけを変えます。LAN IP の `http://` のままでは Supabase Auth のリダイレクトが戻れないため、sslip.io や `pnpm dev:https`（tailnet）のホスト名を使います。**戻すのを忘れてコミットしないこと**（`node ios/scripts/check-consistency.mjs` と `pnpm test:unit` が本番URLかを確かめます）。

## Supabase側の設定

**新しく登録するURLは不要**な設計です。認証シートが開くのは Web版の `/auth/native/start` で、Supabase・Google に返るのは既存の `https://aide-bot.gucchii.com/auth/callback` だけです。`morrow://` へ戻すのはサーバーで、許可リストには登録しません。

ただし戻り先が `/auth/callback?native=1&challenge=…&next=…` とクエリ付きになります。Supabase の Redirect URLs が完全一致だけだと弾かれる可能性があるため、**実機で最初のログインが通るかを確かめてください**。通らなければ `https://aide-bot.gucchii.com/auth/callback**` のようにワイルドカードを足します（共有Supabaseプロジェクトの設定）。

## 仕組み

### Googleログイン（認証シート → 引き継ぎコード → WebView）

`ASWebAuthenticationSession` と `WKWebView` は Cookie を共有しません。Morrow のログインは `@supabase/ssr` の Cookie セッションなので、次の方式でWebViewへ引き継ぎます。**認証シートは毎回エフェメラル**（Safariの既存ログインに触れない代わりに、毎回Googleの入力が要る）。

1. Web の `/login` の「Googleでログイン」（素の `<a href="/auth/signin?next=…">`）を、アプリが捕まえてWebView内では開かない
2. アプリが PKCE の `verifier`（乱数）と `challenge`（S256）を作り、認証シートで `/auth/native/start?challenge=…&next=…` を開く
3. Google → Supabase → サーバーの `/auth/callback?native=1&…`。**許可メールアドレス（`ALLOWED_GOOGLE_EMAILS`）の確認とユーザー作成は Web版と同じ箇所**で行い、許可外は `morrow://auth-callback?error=not_allowed`
4. サーバーはセッションのトークンを暗号化して60秒だけDBへ置き、**トークンではなく一度限りのコード**だけを `morrow://auth-callback?code=…` で返す
5. アプリはWebViewの中から `POST /auth/native/consume`（本文に `code` と `verifier`）を呼び、通常の Supabase SSR Cookie を受け取ってから `next` を開く（ここでも許可リストを再確認する）

使用済み・期限切れ・別用途・verifier不一致のコードはすべて同じ拒否。トークンは、URL・アプリのログ・Swiftのコードのどこにも出ません。コードは `verifier` が無ければ消費できないので、他のアプリが `morrow://` を横取りしてもログインできません。取消・失敗・許可外では履歴を出さず `/login` へ戻り、もう一度ログインを試せます。

### ログアウト・セッション失効

ログアウトは Web のフォーム（`POST /auth/signout`）のままで、このアプリのセッションだけを終わらせます（`signOutThisApp()`・scope: local）。共有Supabaseの他アプリ・他端末はログアウトされません。許可リストから外れたアカウントやセッション失効は、middlewareが `/login` へ戻します。ログイン状態は WKWebView の既定データストアに残り、再起動しても維持されます。

### 外部リンク・通信失敗・ダイアログ

- Morrowと同一オリジン（スキーム・ホスト・ポート）だけをWebView内で開き、他はSafariで開く（`AppConfig.isAppURL`）
- 通信できない・5xx のときは `ConnectionErrorView` が理由と「再読み込み」を出す。回線が戻れば自動で読み直す。再接続後はサーバーの履歴がそのまま読める（送信中に切れた発言は、再読み込み後の履歴に残っているかで確認する）
- `alert` / `confirm` は `WKUIDelegate` で実装（無いと確認が常に「キャンセル」になる）

### 音声機能の対応状況（初版）

音声バー（「話しかける」）はブラウザの Web Speech API（`SpeechRecognition`）に依存します。**WKWebView ではこの API が使えない可能性が高く**、使えない場合はWeb側がマイクを出さないので、文字での相談は妨げられません。**実機での可否は下の確認表に記録してください**（WebView化だけで既知の音声問題が解消するとは見なさない）。ネイティブの音声入出力は後続Issueです。

### オフライン表示について

WKWebView では Service Worker を使えません。PWA の保存済み画面を使う仕組みはアプリ内では効かず、代わりに再試行の画面を出します。

## 実機確認（本人がMacとiPhoneで行う。未実施）

PRのマージとTestFlight確認は別です。**この表が埋まるまで #441 の要件は満たしたことになりません。**

| 項目 | 結果（ビルド番号・バージョン） |
|---|---|
| Xcodeでビルドでき、Morrowの名称・アイコンでiPhoneに起動する | 未確認 |
| 許可アカウントでログインしてアプリに戻れる／取消・許可外アカウントは履歴を出さず再試行できる | 未確認 |
| Webの既存会話を読め、iOSから送った発言・返答がWebにも残る | 未確認 |
| 完全終了して開き直してもログイン・会話が復元される／ログアウトで再ログインへ誘導される | 未確認 |
| 日本語入力・変換確定（意図せず送信しない）・送信・返答表示 | 未確認 |
| キーボード表示中に入力欄と最新の会話が使える | 未確認 |
| 機内モードで再試行画面が出て、戻すと自動で読み込まれる | 未確認 |
| Safari・PWA・PCの既存ログイン・会話・通知が今までどおり動く（アプリのログインでSafari側がログアウトされない） | 未確認 |
| TestFlightから初回インストールでき、上記が通る | 未確認 |
| 音声バー（マイク）が出るか・動くか | 未確認 |

## 初版スコープ外（後続Issue）

ネイティブプッシュ通知・通知からの画面遷移 / 共有メニューから文章・URLを渡す機能 / App Intents・ショートカット・ウィジェット / 音声入出力のネイティブ実装・常時マイク / TestFlight配布のCI自動化 / App Store公開 / 会話画面のSwift化。
