# aide-bot 固有ルール

このファイルは、このリポジトリで作業するすべてのエージェント（ローカルのClaude Code・GitHub Actions上の
無人実行の両方）が読む前提の運用ルールを置く。**GitHub Actions上の無人実行は、個人環境の
`~/.claude/CLAUDE.md` もスキルも読み込まない。** Actionsでも守らせたいルールはここに書く。

## アプリ概要

NotionやAIDE（`guchi-apps/aide`）などを参照し、チャットボットでプライベートを補佐するPWA。

| 項目 | 値 |
|---|---|
| 本番URL | `https://aide-bot.gucchii.com/` |
| 本番ポート | `3103`（PM2 プロセス名 `aide-bot`） |
| 配布先 | VPS の `/apps/aide-bot/` |
| データベース | `app_aide_bot`（MariaDB / Prisma） |
| 認証 | Supabase Auth（Google）。他アプリと共有のSupabaseプロジェクト |
| パッケージマネージャ | pnpm（`packageManager` は10系に固定。VPSのNodeが20系のため11系は動かない） |

**ポートの正は `vps` リポジトリのアプリ一覧**（[ports.md](https://github.com/guchi-apps/docs/blob/main/standards/ports.md)）。
`deploy/ecosystem.config.js` と `.github/workflows/deploy.yml` の既定値がそれに揃っている。

**`PORT` はシークレットではなく設定値として扱う。** 1Passwordにも `.github/secrets-manifest.tsv` にも置かず、
`deploy.yml` のSSHスクリプト内に平文で持つ（ports.md「ポート番号は 1Password で管理しない」）。
GitHub変数 `vars.PORT` は使わない。マニフェストへ戻さないこと（#5）。

## このリポジトリの構成（エージェント向けの前提）

```
src/app/          画面とRoute Handler（App Router）
src/components/   画面のUIコンポーネント（機能ごとのディレクトリに分ける）
src/lib/          Supabaseクライアント・Prismaクライアント・共通ユーティリティ
src/proxy.ts      Next.js 16のミドルウェア。全リクエストのセッション検証を担う
prisma/           スキーマとマイグレーション
deploy/           PM2設定
scripts/          開発・デプロイ補助スクリプト
.github/          CI・デプロイ・マルチエージェント運用のワークフロー
```

## 認証

- Supabase Auth の Google プロバイダを使う。セッションの検証は `src/proxy.ts`（→ `src/lib/supabase/middleware.ts`）が
  **1リクエストにつき1回だけ**行い、結果を `x-aide-bot-supabase-user-id` ヘッダーで後段へ渡す。
  ページやRoute Handlerで `auth.getUser()` を呼び直さない（Supabaseへの往復が倍になる）
- ログイン中のユーザーは `getCurrentUser()`（`src/lib/auth-user.ts`）で取得する
- 利用できるのは `ALLOWED_GOOGLE_EMAILS` に列挙したGoogleアカウントのみ。判定は
  `isAllowedEmail()`（`src/lib/allowed-users.ts`）に閉じてあるので、公開範囲を変えるときはここだけを直す。
  **未設定時は全員拒否**（設定漏れで誰でも入れる状態にしないため）
- ログイン・ログアウトの導線はクライアントJSに依存させない。開始は `/auth/signin`（Route Handlerが
  認可URLを組み立てて302）、ログアウトはフォームのPOSTで `/auth/signout`。
  ハイドレーション前でも押せるようにするため

### 開発用ログイン（Cookieバイパス）

**エージェントは対話的なOAuthを完了できないため、ログイン後の画面はこの導線からしか見られない。**
判定は `src/lib/ci-auth-bypass.ts` に閉じてあり、`src/lib/supabase/middleware.ts` と
`src/lib/auth-user.ts` の**両方**が同じ判定を行う（middlewareだけ通してもデータが引けない）。

```bash
pnpm db:seed:dev   # ダミーユーザーを投入し CI_LOGIN_BYPASS_SECRET を .env.local へ生成する
pnpm dev           # 生成した値は再起動しないと効かない
curl -s -c /tmp/cookies.txt -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST http://localhost:<ポート>/api/dev/login          # 303 -> /
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' http://localhost:<ポート>/   # 200
```

- **本番で有効にならないことを二重に塞いでいる。** `NODE_ENV=production` での無効化と、
  `CI_LOGIN_BYPASS_SECRET` 未設定での無効化。**片方だけ緩めない**
- ダミーユーザーの `supabaseUserId` は `ci-screenshot-bot`。値は `src/lib/ci-auth-bypass.ts` と
  `scripts/seed-ci-db.mjs` に二重に持っている（後者はプレーンJSでTSをimportできない）。
  **片方だけ変えると、ログインは通るのに画面が `/login` へ戻り続ける**
- **画面に出るモデルを追加したIssueは、同じPRで `scripts/seed-ci-db.mjs` へダミーデータも足す。**
  認証を抜けても開発DBが空なら画面は空のままで検証にならない
- シークレットの実値はコミット・PR本文・Issueコメント・ログのいずれにも書かない

## チャット（相談）

- 相談は話題ごとの `Conversation` に分ける。**対話相手は常に同じ「秘書」1人**で、
  相手を選ぶ・切り替える導線は作らない。スレッドは相手の分け目ではなく話題の分け目（#24）
- 返答の生成は `POST /api/chat`。`src/lib/anthropic.ts` の `CHAT_MODEL`（`claude-opus-5`）を
  Messages APIのストリーミングで叩き、Server-Sent Eventsで逐次返す
- **`ANTHROPIC_API_KEY` はモジュールの読み込み時に検証しない。** ビルド時にはこの値が無く
  （CIもActions上のビルドも持たない）、importの時点で投げると `next build` が落ちる。
  `getAnthropicClient()` の中で見る
- 履歴は毎回まるごと送り直すため、`HISTORY_LIMIT`（直近30発言）で頭を切る。上限を外すと
  長いスレッドほど1往復の入力トークンが際限なく伸びる
- **`Conversation.updatedAt` は発言を足しても動かない。** 一覧の並び順はこの列だけを見ている
  ので、発言を保存するときは同じトランザクションで `conversation.update` も呼ぶ
- 入力欄のEnter送信は `event.nativeEvent.isComposing` で必ず弾く。日本語入力の変換確定の
  Enterがそのまま送信になる

### 返答への割り込み（#48）

**返答の途中でも次の発言を送れる。** 「書く」は入力欄からの送信、「話す」はマイクを押した時点で、
走っている生成を打ち切ってそのまま次の往復へ入る。

- **打ち切られた返答を保存するのは、打ち切られた側のリクエスト**（`request.signal` が落ちて
  ストリームのループを抜けた後）。割り込んだリクエストが先に発言を保存すると、遮られた返答の方が
  後ろの `createdAt` で入り、**再読み込みしたときだけ秘書の返答が自分の次の発言より下へ回る。**
  `src/app/api/chat/route.ts` の `pendingGenerations`（プロセス内のMap）で、同じスレッドの生成が
  畳まれるまで次のリクエストを待たせている。PM2で1プロセスしか動かさないことが前提
- **画面側も同じ順序を守る。** 打ち切られた往復が「そこまでの返答」を並べ終えるのを待ってから
  次の発言を足す（`ChatPanel` の `turnRef` / `VoicePanel` の `turnRef`）。待たずに足すと、
  DBの並びは正しいのに画面上だけ順序が入れ替わる
- **途中で切れた返答は `Message.interrupted` で区別する。** 本文へ注記を混ぜず、モデルへ渡す
  ときだけ `INTERRUPTED_NOTE`（`src/lib/anthropic.ts`）を添える。印が無いと、モデルからは
  「短く言い切った返答」と見分けが付かず、続きを最初から言い直す
- **新しい相談の1通目を割り込むと、`router.replace()` が効く前に2通目が飛ぶ。**
  propsの `conversationId` はまだ `null` なので、そのまま送るとスレッドがもう1本作られる。
  `useChatStream` が `meta` で受け取ったIDを覚えて使う
- **「話す」では読み上げ中にマイクを開かない方針を変えていない。** 割り込みは「押した瞬間に
  黙ってから聞き取りを開く」形で、読み上げ中もマイクを開きっぱなしにする常時バージインは
  採っていない（自分の声を拾って往復が止まらなくなるため）

## APIの消費量（#51）

Messages APIを1回呼ぶごとにトークン数を `ApiUsage` の1行として残し、`/usage` の画面で
日・月・累計に足し上げて出す。左メニューの下部に今月の概算費用も出る。

- **数える単位は「API呼び出し1回」で、秘書の返答（`Message`）には持たせない。** 返答は
  `answer.trim() !== ""` のときしか保存されず、1文字も出ないうちに割り込まれた往復・生成に
  失敗した往復では行そのものが作られない。履歴を毎回まるごと送り直す設計上、**入力ぶんは
  その時点で使い終わっている**ので、返答の行に相乗りさせるとそこが丸ごと落ちる（#51の計画レビュー）。
  1発言に対してAPIを複数回叩く形になっても、この単位なら数え方が変わらない
- **トークン数は `message_start` と `message_delta` の両方から拾う。** 入力ぶんは `message_start`、
  出力ぶんは `message_delta`（累計値。生成中に何度か届く）に乗る。`content_block_delta` しか
  見ていないと1つも取れない
- **途中で遮られた往復（#48）では `message_delta` が届かず、出力ぶんが実際より少なく残る。**
  `message_start` 時点の値（数トークン）のままになる。埋め合わせの推定はせず、画面の注記で断っている
- **使用量の記録に失敗しても相談は止めない。** `ApiUsage` の書き込みは独立したtry/catchに置き、
  失敗はログにだけ残す（記録できないことより、返答が返らないことの方が重い）
- **単価表は `src/lib/usage.ts` の `MODEL_PRICING`。** Anthropicが単価を変えたらここを直す。
  呼び出した時点のモデル名で引き直すため、使うのをやめたモデルの行も消さない。画面に出るのは
  概算で、実際の請求額ではない（円は `USD_JPY_RATE` の固定レートでの参考値）
- **キャッシュぶんの列（`cacheWriteTokens` / `cacheReadTokens`）はいまは常に0。** プロンプト
  キャッシュを使っていないため。単価が入力と違うので列は持つが、画面の内訳には出していない
- **`src/lib/usage.ts` はサーバー専用。** Prismaと（`@/lib/anthropic` 経由で）Anthropic SDKを
  引き込むため、クライアントコンポーネントからimportしない。`/usage` の画面
  （`src/components/chat/usage-view.tsx`）は数字を見るだけなのでサーバーコンポーネントのまま置いている

## 音声対話（話す / 書く）

**このアプリの本来の使い方は音声**で、文字入力は声を出せない場面と言い直しのために残している（#27）。
どちらのモードでも同じ `Conversation` へ残り、`POST /api/chat` も共通。既定は「話す」で、
選んだモードはCookie `aide-bot-talk-mode`（`src/lib/talk-mode.ts`）に持つ。

- **聞き取りはブラウザ内蔵のWeb Speech APIだけで行う**（`src/lib/speech/`）。
  音声を外部へ送らないので追加のAPIキーも実費も無い。対応はChrome / Edge / Safariに限られ、
  **Firefoxは聞き取りに非対応**。使えない端末には案内を出して「書く」へ寄せる。
  外部STTへ寄せる判断をするときは、依存とキーと実費が増えることをIssueで先に確認する
- **読み上げだけは外へ出る経路がある。** 声にVOICEVOXの話者（ずんだもん等）を選び、かつ
  **自前のVOICEVOX ENGINEが設定されていない（または届かない）ときに限り**、返答の文面が
  WEB版VOICEVOX API（`api.tts.quest`。VOICEVOX公式ではない第三者のサービス）へ
  送られる（#41・#57、`src/lib/speech/voicevox.ts`）。**既定は端末内蔵の声のまま**にしてあり、
  APIキー・依存パッケージ・サーバー側のルートはいずれも増やしていない（CORSが開いているので
  ブラウザから直接呼ぶ）。話者を増減させるときは `VOICEVOX_SPEAKERS` を直す。
  一覧を返すエンドポイントは公開されていないため、IDと名前は合成の応答（`speakerName`）で確かめる
- **合成した音声は第三者のサーバーに残り、URLは文面から決まる。** 同じ文面・同じ話者なら
  何度依頼しても同じURL（64桁のhex）が返り、40分後も認証なしで取得できた。保持期間は
  公表されていない。**列挙はできない（存在しないハッシュは404）が、文面を知っていれば誰でも
  取得できる**ので、公開範囲を絞ったアプリで使う前提を変えるときはこの性質から見直す（#41）
- **VOICEVOXはキー無しだと5秒に1リクエスト。** 超えると `retryAfter` 付きで断られるため、
  内蔵の声のように文ごとへ刻めない。合成しながら流れてくる `mp3StreamingUrl` を `<audio>` で鳴らす。
  **断られたことは HTTP 429 で返るが、待つ秒数は本文にしか入っていない。**
  ステータスだけで例外にすると、待てば通る場合まで失敗になる。
  **`retryAfter` は通常5秒前後だが、短い間隔で何度も投げた後は61秒が返る**（#52で実測）。
  待てる上限（`MAX_RETRY_WAIT_MS`）は前者を拾い後者を落とせる値にする
- **キー無しの合成は、依頼から最初の音まで6〜8秒かかる**（#52で実測。文の長さではほとんど
  変わらない——合成しながら流すため）。**返答が出そろってから1回だけ出すと、字幕が出た後に
  7秒以上の無音ができ、「ずんだもんだと音が聞こえない」に見える。** そこで `VoicevoxReader` は
  **最大2回に分ける**——1文目が揃った時点で1回目を依頼して返答の生成中に合成を進め、残りは
  1回目が鳴り始めてから依頼する（そこまでで7秒前後経つので5秒の制限に触れない）。
  実測で「返答が出てから声が始まるまで」が約7秒→約0.5秒になった
- **合成の宛先は2つある**（#57、`resolveVoicevoxSource()`）。自前のVOICEVOX ENGINEのURLが
  設定されていて `GET /version` が届けばそちら、駄目ならWEB版API。**判定は端末ごと・
  一定時間だけキャッシュ**する（tailnet内のsubpcで動かす想定で、tailnet外の端末からは届かない）。
  届かない端末では調べる時間ぶん最初のひと声が遅れるので、マイクを押した時点で
  `warmVoicevoxSource()` を呼んで先に済ませておく
- **ENGINEのURLは環境変数で配らない。端末ごとの設定（localStorage）に持つ**（#57）。
  tailnetのホスト名であり、**このリポジトリも本番サイトも公開されている**ため、
  `NEXT_PUBLIC_*` に置くとJSバンドル越しに誰でも読める（ログイン前のページでも配信される）。
  `PORT` のような「設定値だから平文でよい」とは別の判断になる
- **ENGINEはWEB版とAPIの形が違う。** `POST /audio_query?text=&speaker=`（本文なし）でJSONを
  受け取り、それをそのまま `POST /synthesis?speaker=` の本文へ渡すとWAVが返る。
  **`mp3StreamingUrl` のような「合成しながら流す」仕組みは無く、合成し終えてから返る**ので、
  まとめて投げると長い返答ほど鳴り始めが遅くなる。そこで**ENGINEのときだけ文の切れ目で刻む**
  （レート制限が無いので刻める）。次のぶんの合成が前のぶんの再生に隠れる。
  ブラウザから直接叩くため、ENGINE側でCORSを開ける必要がある（`--cors_policy_mode all`）。
  返ってくるのはBlobなので、鳴らし終えたら `URL.revokeObjectURL()` で手放す
- **待っていることを必ず画面へ出す**（`onPreparing` → `RobotState` の `preparing`）。
  「考えています」のままにすると返事が来ていないように見え、利用者がマイクを押して
  割り込む——割り込みは読み上げを取り消すので、**一度も鳴らないまま終わる**
- **合成や再生に失敗したら端末内蔵の声へ落とす**（`VoicevoxReader`）。外部サービスが混んでいる
  だけで秘書が黙り込むのを防ぐため。鳴り始めた後で切れたぶんは読み直さない。
  **ただし `speechSynthesis` があることと鳴らせる声があることは別。** 声が0件の端末
  （speech-dispatcherの無いLinuxのChromeなど）では落とした先でも無音のまま `onend` だけが
  返るので、`getVoices().length` を見て、その場合は案内を出す
- **`<audio>` は1つを使い回す。** iOSは「画面を触った流れ」で一度 `play()` を通した要素しか
  後から鳴らせない。マイクを押した時点で `primeVoicevoxAudio()` を呼び、その要素の `src` を
  差し替えて使う（内蔵の声の `primeSpeechSynthesis()` と同じ考え方）
- **`SpeechRecognition` の型はTypeScriptの標準libに無い。** `src/types/speech.d.ts` に使う範囲
  だけを宣言してある。接頭辞なしと `webkit` 付きの両方を見ること（Safariは `webkit` 付きのみ）
- **iOSは「画面を触った流れ」で一度 `speak()` を通さないと、以降の読み上げが無音になる。**
  マイクを押した時点で `primeSpeechSynthesis()` を呼び、その操作を許可として使っている
- **読み上げ中にマイクを開かない。** 自分の声を聞き返して往復が止まらなくなる。
  ひと往復は idle → listening → thinking →（VOICEVOXなら preparing →）speaking → idle で、
  次の状態を決めるのは読み上げの完了（`SpeechReader` の `onDrain`）
- **返答は届いた端から文の切れ目で読み上げる。** 全部揃うまで待つと、字幕は出ているのに
  声が始まらない時間ができる。1回の `speak()` を長くしすぎない（Chromeが途中で打ち切る）
- **画面の中央にいるロボットは `src/components/voice/robot.tsx`、動きは `globals.css` の `.bot` 系**
  （#49）。待つ・聞く・考える・話すの4状態を1つの値から出し分ける。**部品を動かすときは
  `transform-box: view-box` を付けてから `transform-origin` をviewBoxの座標で書く。**
  既定（`fill-box`）だと基準が部品ごとの外接矩形になり、目や口が自分の中心ではないところを
  軸に動く（`librsvg` はこの指定を解釈しないので、見た目の確認はブラウザで行う）
- 音声モードは `mode: "voice"` を送り、`VOICE_STYLE_INSTRUCTION` と `VOICE_MAX_OUTPUT_TOKENS`
  （1200）が効く。**聞くだけの返答は戻って読み直せない**ため、文字のときと同じ上限にしない
- **localStorageの値をuseStateの初期値やuseEffectで入れない。** ESLintの
  `react-hooks/set-state-in-effect` に掛かり、ハイドレーションもずれる。
  `useSyncExternalStore`（`src/lib/speech/voice-settings.ts`）で外部ストアとして扱う
- **マイクはHTTPS（またはlocalhost）でしか開けない**（secure context 限定）。
  **`sslip.io` はスマホ実機での音声確認に使えない**——http でしか開けないため、画面は出るのに
  マイクが起動しない（`scripts/dev.sh` は `next dev` を素で起動しTLSを張らない）。
  実機で音声を確かめるときは `tailscale serve --bg --https=443 <ポート>` でHTTPSを付け、
  `https://subpc.<tailnet>.ts.net/` を開く。`allowedDevOrigins` には `**.ts.net` が入っている。
  **サブPCのTailnetはHTTPS証明書が未有効**（`tailscale status --json` の `CertDomains` が
  `null`）なので、初回は管理画面での有効化が要る（#32）

## アイコン

- **アイコンの正は `public/icon.svg` の1枚だけ。** `public/icon-192.png`・`public/icon-512.png`・
  `public/apple-icon.png`・`src/app/favicon.ico` はすべてそこからの書き出し物で、
  `scripts/build-icons.sh`（`rsvg-convert` と ImageMagick を使う）で作り直す。
  PNGを直接編集しても、次にスクリプトを流した時点で戻る
- **`public/icon.svg` の絵は `<g transform="translate(38.4 24) scale(0.85)">` の中に置く。**
  `manifest.ts` は512pxを `purpose: "maskable"` としても宣言しており、Androidのアダプティブ
  アイコンは中心から半径204.8pxの円の外を切り落とす。素の512px座標のままだと、頭の
  アンテナと下端の足が欠ける
- 画面の中で使うアイコンは `src/components/brand/app-icon.tsx`（インラインSVG）。26px前後で置く
  場所が多いため、ファイルを `<img>` で読ませない。**絵を変えるときはSVGファイルと
  このコンポーネントの両方を揃えて直す**（グラデーション・編み目の模様・maskableの余白は、
  この大きさでは効かないのでコンポーネント側には持たせていない）
- **`app-icon.tsx` では `id` を使わない**（#49）。「書く」画面は返答1件ごとにこのアイコンを
  描くため、グラデーションを `url(#…)` で参照する書き方にすると、同じidが1ページに何個も出る。
  ベタ塗りで足りる大きさなので、グラデーションはSVGファイル側にだけ持たせている

## バージョン表示

- **画面に出るバージョンの正は `package.json` の `version`。** 左メニュー（`ConversationRail`）の
  最下部に `v0.3.0` の形で出る。リリース時のbumpを忘れると、本番の画面に古い版が出続ける
- **`src/lib/app-version.ts` はサーバーコンポーネント専用。クライアントコンポーネントから
  importしないこと。** JSONのimportはプロパティ単位では削られず、`package.json` が丸ごと
  クライアントバンドルへ入る（実際に依存パッケージ名と `packageManager` のハッシュが
  `.next/static/chunks` に出た）。値は `src/app/(chat)/layout.tsx` で読み、
  `ChatShell` → `ConversationRail` へpropsで渡している

## 検証コマンド

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm build:ci    # prisma generate && next build
```

CI（`.github/workflows/ci.yml`）はこの3つを実行する。ビルドは外部サービスへ接続しないため、
`DATABASE_URL` と `NEXT_PUBLIC_SUPABASE_*` はCI専用のプレースホルダーでよい。

### 返答の生成をキー無しで確かめる

`ANTHROPIC_API_KEY` が手元に無くても、**`ANTHROPIC_BASE_URL` をローカルのスタブへ向ければ
`/api/chat` を丸ごと動かせる。** SDKは `${ANTHROPIC_BASE_URL}/v1/messages` を叩くだけなので、
Messages APIのSSE（`message_start` → `content_block_delta`×n → `message_stop`）を1秒あたり数個の
ペースで返すHTTPサーバーを立てれば、ストリーミング・中断・保存・履歴の組み立てまで実キーも
実費もなしに確かめられる。受け取った `messages` をファイルへ書き出しておくと、モデルへ実際に
渡している履歴（割り込みの注記など）もそのまま読める。

`curl -sN` を `timeout` で切れば「利用者が途中で止めた」経路をそのまま再現できる。

**画面の動き（CSSアニメーション）を確かめるときは、`rsvg-convert` の書き出しを根拠にしない**（#49）。
librsvgは `transform-box` を解釈しないため、ブラウザでは正しい位置で動く部品が、書き出したPNGでは
まったく別の場所へ飛ぶ。ヘッドレスChromeは `~/.cache/ms-playwright/chromium_headless_shell-*/` に
入っており、Playwrightを使わなくても1枚だけなら撮れる。

```bash
chrome-headless-shell --headless --disable-gpu --no-sandbox --window-size=1060,300 \
  --screenshot=out.png "file:///<確認用のHTML>"
```

**撮った瞬間はアニメーションの0秒地点なので、途中の姿は写らない。** `--virtual-time-budget` を
足してもCSSアニメーションは進まない。見たい時点があるなら、確認用のHTML側で
`animation-delay: -0.5s` のように負の値を当てて、その姿で止めてから撮る。

**検証用に一時的なページを足して消したら、`rm -rf .next` してから型チェックする。**
`next dev` が生成する `.next/dev/types/validator.ts` は消したルートを参照したまま残り、
`pnpm typecheck` と `pnpm build:ci` が `TS2307: Cannot find module '../../../src/app/<消した名前>/page.js'`
で落ちる。ソースにはもうそのファイルが無いので、原因がコードの側に見えない。

## ローカル開発

```bash
pnpm install
pnpm env:init            # .env.local.example を .env.local へコピーして編集する
pnpm db:setup            # .env.local の DATABASE_URL から DB・ユーザーを作成する
pnpm db:migrate:dev
pnpm dev                 # http://localhost:3000
```

Supabase の Redirect URLs に、開発で使うオリジンの `/auth/callback` を登録しておく必要がある。

### worktreeで画面を確認するときの注意

- **`.env.local` の `DATABASE_URL` は全worktreeで同じローカルDB（`app_aide_bot`）を指す。**
  別Issueのセッションが `prisma migrate dev` を流していると、こちらのスキーマには無いテーブルが
  すでに存在する。壊し合わないよう、検証で書き込みを伴う場合はDB名を変えて隔離する
  （`CREATE DATABASE app_aide_bot_issue<番号>` → `pnpm db:migrate:deploy` → 確認後に `DROP`）
- **Next.js 16の `next dev` は同じディレクトリで2つ起動できない**（`Another next dev server is
  already running.` で終了する）。ポートを変えても回避できないので、環境変数を変えて起動し直す
  検証では、先に動いているサーバーを落とす
- **`next start` も `.env.local` を読む。** 本番相当（`NODE_ENV=production`）での無効化を
  確かめるときは、開発用の値が読み込まれていることを `/proc/<pid>/environ` で確認したうえで
  試す。読み込まれていないだけなら「シークレット未設定」側の錠が効いただけで、確認にならない

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、成果物を
VPSへ配ってPM2で再起動する（VPS上で `next build` はしない。メモリが足りないため）。

**デプロイに必要な値の取得元は `.github/secrets-manifest.tsv` が正**。ワークフローの `env:` ブロックは
`scripts/generate-workflow-env-block.sh` で生成する。1Passwordは「人が管理する唯一の正」として残り、
値を変えたときだけ `scripts/sync-github-secrets.sh` でGitHubへ同期する
（実行時に1Passwordを読まない理由は guchi-apps/issue-deck#1302・#1307）。

### 初回デプロイの前に埋めるもの（#4）

**GitHubのsecret / variableは新規リポジトリでは空のまま**で、`deploy.yml` の `env:` は空文字を渡す。
`${{ secrets.X }}` は未登録でもエラーにならないため、失敗するのは値を実際に使う場所になる。
aide-botでは build ジョブの「Construct DATABASE_URL」が
`DB_NAME: DB_NAME is required` で落ちた（run 32648571956）。

初回は上流の1Passwordアイテムごと存在しないので、次の順で埋める。**どれもエージェントは代行できない**
（1Passwordへの書き込み・Signalyのチャンネル作成・本番デプロイの実行はいずれも人の操作）。

1. Signalyでこのアプリ用の通知チャンネルを作り、Webhook URLを控える
2. 1Passwordの `apps` ボールトに `aide-bot` アイテムを作り、`target-dir` / `db-name` /
   `allowed-google-emails` / `ci-webhook-url` を登録する。値の形は他アプリのアイテムに揃える
   （`target-dir` は `/home/github-user/apps/aide-bot`、`db-name` は `app_aide_bot`）
3. `eval $(op signin)` の後に `scripts/sync-github-secrets.sh --dry-run` → 本実行。
   **個人アカウントで実行する**（サービスアカウントは日次1,000リクエストの共有枠を消費する）
4. `gh api repos/guchi-apps/aide-bot/actions/secrets --jq .total_count` で登録件数を確かめてから
   Deploy to Production を再実行する

**secretを埋めてもまだ公開はされない。** `deploy.yml` のヘルスチェックはVPS内の
`http://127.0.0.1:3103/` を叩くだけなので、Apacheのvhostが無くてもdeployジョブは成功する。
`https://aide-bot.gucchii.com/` を通すには `guchi-apps/vps` 側でvhostとTLS証明書を用意し、
アプリ一覧へ3103を登録する必要がある（`curl` でTLSハンドシェイクが
`no alternative certificate subject name matches` になる間は未設定）。

### マイグレーションSQLにdotenvの出力を混ぜない（#9）

`prisma.config.ts` の `loadEnv()` には **`quiet: true` を必ず付ける**。dotenv v17は読み込み時の
案内文を**stdout**へ出力し、Prismaは同じstdoutへ `migrate dev` / `migrate diff --script` の
SQLを書き出すため、案内文がそのまま `migration.sql` の1行目に入り込む。

ローカルでは誰も実行しないので気付けず、本番の `prisma migrate deploy` で初めて
MariaDBの構文エラー（1064 / P3018）として出る。実際に `20260823000000_init` がこの形で壊れ、
初回デプロイが失敗した（run 32720715118）。

マイグレーションを追加したら、コミット前に生成物と突き合わせる。

```bash
pnpm exec prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
```

**本番で一度失敗したマイグレーションは、直したSQLを配っても自動では復旧しない。**
`_prisma_migrations` に失敗として記録が残り、以後の `migrate deploy` はP3009で止まる。
VPS上で `pnpm exec prisma migrate resolve --rolled-back <マイグレーション名>` を実行してから
デプロイし直す。

---

# Issueごとの複数Claude Codeエージェント運用

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成〜レビュー〜マージまでをGitHub Actions上で
無人実行する運用を導入している。仕組みの本体は `guchi-apps/issue-deck` にあり、aide-botはその
再利用可能ワークフロー（`workflows/v27` タグ）を参照する側として構成している。

設計の詳細・各モードの判定ロジックは issue-deck の `docs/multi-agent-workflow.md`・`docs/multi-agent/` を
一次情報源とする。ここにはaide-bot側の運用に必要な事項のみを置く。

## ブランチ運用

- `main` は本番と一致するリリース用ブランチ。直接pushは禁止し、`develop` → `main` のPRのみで進める
- `develop` が日常の開発ブランチ（デフォルトブランチ）
- Issue専用ブランチは `develop` から作成し、ブランチ名は `issue-<Issue番号>` とする（例: `issue-12`）。
  進捗遷移・レビュー・コンフリクト解消の各ワークフローはこの命名規約からIssue番号を特定するため、
  従わないブランチはすべて対象外になる
- worktreeは本体リポジトリの外（`~/apps/aide-bot-worktrees/<ブランチ名>/`）に作成する。
  本体 `~/apps/aide-bot` は `develop` の最新チェックアウトとして空けておく

## Issueの進捗

**進捗はGitHub ProjectsのStatusで管理する。唯一の正はStatusで、進捗ラベルは存在しない。**

原則として以下の順で遷移する。`Planning` は `21.plan-required` が付いている場合のみ経由する。

1. `Ready` — 未着手
2. `Planning` — 計画を検討中
3. `Implementation` — 実装中
4. `Develop PR` — developへPR作成・マージ中
5. `Develop` — developへマージ完了（main未反映）
6. `Release` — mainへのPR作成・マージ中
7. `Done` — mainへマージ完了。**この時点でissueをclose**する

**`gh issue edit` で進捗を進めることはできない。** Statusを書けるのはissue-deckだけで、
ワークフローは進捗報告API（`POST /api/progress`）へ報告する。ブランチのpush・PR作成・PRマージを
トリガーに自動で遷移するため、**エージェントが自分で進捗を動かす必要はない。**

`00.check-user`（ユーザーの確認・指示が必要）は、上記のどの段階でも他のラベルと併用して付与する。
`00.check-user` を人間が外す操作が「承認」を意味する。理由は `01.check-*` で併記する。

オプション制御のラベル:

| ラベル | 効果 |
|---|---|
| `21.plan-required` | 実装前に計画を提示し、承認を得てから実装に入る |
| `22.merge-confirm-required` | 内容によらず、developへのマージ前に必ず `00.check-user` を付ける |
| `23.preview-required` | PR作成前に開発サーバーの画面で確認し、承認を得る |
| `24.screenshot-required` | PR作成前にスクリーンショットで確認し、承認を得る。**無人実行ではまだ使えない**（開発用ログイン（Cookieバイパス）は#25で入ったが、スクリーンショットを撮るPlaywright依存とワークフロー側の手当てが無いため） |
| `25.artifact-required` | 実装着手前に見た目のアーティファクトを公開し、承認を得る（ローカル実行専用） |
| `11.local` | 付いている間、無人実行ワークフローが計画・実装・分割・追加対応を行わない。ローカルのClaude Codeセッションと二重に進めないための停止フラグ |
| `71.manual-step` | エージェントが代行できないユーザー自身の手作業を追跡するIssue |

## 自動マージ不可カテゴリ

以下に該当する変更は、レビュー・統合エージェントが自動マージせず `00.check-user` を付与して
ユーザーの確認を待つ。`claude-review-develop.yml` の `risk-check` ジョブがパスパターンで一次判定し、
パターンに掛からない意味的なリスクはレビューエージェントが二次判定する。

- 認証・認可（`src/proxy.ts`、`src/lib/supabase/**`、`src/lib/allowed-users.ts`、`src/app/auth/**`）
- DBスキーマ変更・マイグレーション（`prisma/migrations/**`）
- 本番環境の設定（`deploy/**`、`.github/secrets-manifest.tsv`）
- GitHub Actionsやデプロイ設定（`.github/workflows/**`）
- Secretsや環境変数（`.env*`）
- 課金・決済
- 大規模な依存関係の更新（`package.json` のメジャーバージョン更新）
- `develop` → `main` のマージ

無人実行では確認する相手がその場にいないため、**新しい依存関係の追加が必要になった場合は追加せず**、
`00.check-user` と `01.check-blocked` を付与して停止する。シークレットの実値は、コミット・PR本文・
Issueコメント・ログのいずれにも書かない。

## 並行Issueの意味的コンフリクト（develop向けPRを出す前に確認する）

develop向けPRのCIは、PRを出した時点の `develop` に取り込んだ結果に対して走る。その後に別のIssueが
developへマージされてもCIは自動では回り直さない。このため、**テキスト上は競合しないのに develop 上で
壊れる変更**が、そのまま自動マージで入りうる。

Prismaスキーマのフィールド削除・関数やエクスポートの改名・型の変更を含むIssueと並行して作業している
場合、PR作成の直前に `git fetch origin && git merge origin/develop` してから `pnpm typecheck` を
通す。CIの結果だけを根拠にしない。

## 実装エージェントの禁止事項

- `main` / `develop` への直接コミット・push
- 他Issueのブランチ・worktreeの編集
- 担当Issue以外の実装（別件の起票は可。実装は別セッションで行う）
- 不要なforce push
- 自分が作成したPull Requestの自己マージ
- 共有知識リポジトリ（`.shared-context/` / `~/apps/_docs`）の編集・コミット

レビュー・統合エージェントは、加えて `main` への直接マージ・pushを行わない。

## PR本文テンプレート

`develop` 宛のPRには以下を記載する（日本語で書く）。

- 対応Issue（`closes #番号` / `fixes #番号` は使わず `#番号` のみ。developマージ時点ではissueを
  closeしない運用のため）
- 実装内容
- テスト内容
- 確認方法（画面に関わる変更ではアクセスURLと操作手順）
- 注意点

コミットメッセージ・PRタイトル・PR本文・Issueコメントは日本語で書く。コミットのAuthorは
`Claude Code <claude-code@example.com>` にする。

## ワークフローの構成

すべてissue-deckの再利用可能ワークフローを `@workflows/v27` で参照する薄いcallerで、
ジョブ本体はこのリポジトリに持たない。

| ファイル | 内容 |
|---|---|
| `issue-labels.yml` | 進捗（Project Status）の報告 |
| `claude-issue-dispatch.yml` | `@claude` 起点の計画・実装・PR作成 |
| `claude-review-develop.yml` | develop向けPRの自動レビュー・リスク判定・Auto-merge |
| `claude-conflict-resolve.yml` | developとのコンフリクト自動解消 |
| `claude-ci-fix.yml` | CI失敗の自動修正 |
| `claude-pr-repair.yml` | Issueに紐づかないPRの修復（画面のボタンから起動） |
| `deploy-retry.yml` | デプロイ失敗の再実行（画面のボタンから起動） |
| `sync-secrets.yml` | 1Password（正）からこのリポジトリのsecret / variableへ同期（画面のボタンから起動） |
| `release-develop-to-main.yml` | バージョンbump PR・develop→mainのリリースPR作成 |
| `version-tag-check.yml` | main宛PRでのリリースタグ重複・デプロイ設定漏れの検査 |

**参照しているタグは正ではない。** 上げたらこの表も直すが、実態は `.github/workflows/` の
`uses:` を見るのが確実。**`uses:` のタグと `prompts-ref` は必ず同じ値にする**
（片方だけ上げると新しいワークフローで古いプロンプトが動く）。

### callerに書ける `with:` は、参照しているタグ時点の再利用ワークフローが持つ入力だけ

**存在しない入力を渡すと `startup_failure` になる。** ジョブが1つも作られず、ログも残らないため
原因が分かりにくい。タグを上げるときも、増やした入力がそのタグに実在するかを確かめる。

実際に踏んだ形（aide-bot#1）。

- **`database-name` を受け取るのは `reusable-issue-dispatch.yml` だけ。**
  `reusable-claude-ci-fix.yml`・`reusable-claude-conflict-resolve.yml` には無い。
  DBを使うリポジトリで揃えたくなるが、渡してはいけない
- **`reusable-deploy-retry.yml` は `workflows/v25` に存在しなかった**ため、当時は
  `deploy-retry.yml` のcallerを置けなかった。`workflows/v27` には入っているので現在は置いてある

確認は次のコマンドでできる（issue-deckのチェックアウトが手元にある場合）。

```bash
cd ~/apps/issue-deck
git show workflows/v27:.github/workflows/reusable-claude-ci-fix.yml | awk '/^  workflow_call:/,/^jobs:/'
```

無人実行のたびに `.shared-context/`（共有知識）と `.shared-prompts/`（issue-deck側の
実装プロンプト）がワークツリーへcheckoutされる。**どちらもこのリポジトリの管理対象ではない。**
`.gitignore` 済みなので、**編集・`git add`・コミットを一切行わないこと。**
