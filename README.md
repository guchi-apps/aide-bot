# aide-bot

NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA。

| 項目 | 値 |
|---|---|
| 本番URL | https://aide-bot.gucchii.com/ |
| 本番ポート | `3103`（PM2 プロセス名 `aide-bot`） |
| 配布先 | VPS の `/apps/aide-bot/` |
| データベース | `app_aide_bot`（MariaDB / Prisma） |
| 認証 | Supabase Auth（Google。許可したアカウントのみ） |

## 技術構成

Next.js 16（App Router）+ TypeScript + Tailwind CSS v4 / Prisma + MariaDB / Supabase Auth。
パッケージマネージャは pnpm。

## セットアップ

```bash
pnpm install
pnpm env:init                 # .env.local.example を .env.local へコピー
# .env.local を編集する（DATABASE_URL / NEXT_PUBLIC_SUPABASE_* / ALLOWED_GOOGLE_EMAILS）
pnpm db:setup                 # .env.local の DATABASE_URL から DB・ユーザーを作成
pnpm db:migrate:dev
pnpm dev                      # http://localhost:3000
```

- Supabase の Redirect URLs に、開発で使うオリジンの `/auth/callback`（例: `http://localhost:3000/auth/callback`）を
  登録しておく必要がある
- スマートフォン実機から確認する場合は `sslip.io` でホスト名化したURLを使い、そのURLも
  Redirect URLs に登録する（生のLAN IPではOAuthのリダイレクトが失敗する）
- `PORT` を `.env.local` に書くと開発サーバーのポートを変えられる（既定は3000）

## 開発用ログイン（Cookieバイパス）

全画面がSupabase Auth（Google OAuth）の背後にあり、GUIの無い環境（SSH越しの作業・CIの無人実行）
からは対話的な同意を完了できずログインできない。開発環境に限り、Supabaseを経由せず
ダミーユーザーとして入る導線を用意している。

```bash
pnpm db:seed:dev   # ダミーユーザーを投入し、CI_LOGIN_BYPASS_SECRET を .env.local へ生成する
pnpm dev           # 生成した値は再起動しないと効かない
```

ブラウザではログイン画面に出る「開発用ダミーユーザーでログイン」ボタンを押す。
コマンドだけで確認する場合は次のとおり。

```bash
curl -s -c /tmp/cookies.txt -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  -X POST http://localhost:3000/api/dev/login    # 303 -> / なら成功
curl -s -b /tmp/cookies.txt -o /dev/null -w '%{http_code}\n' http://localhost:3000/   # 200
```

- **本番では二重に無効化している。** `NODE_ENV=production` では常に無効、
  `CI_LOGIN_BYPASS_SECRET` が未設定でも無効。片方だけ緩めないこと
- シークレットの実値はコミットしない（`.env.local` はgit管理外）
- ボタンが出ない・`/api/dev/login` が404を返すときは `CI_LOGIN_BYPASS_SECRET` が空。
  worktreeを新しく作った直後は `.env.local` が無いことがあるので `pnpm env:init` からやり直す

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 型チェック |
| `pnpm build:ci` | CIと同じビルド |
| `pnpm db:migrate:dev` | マイグレーション作成・適用（開発） |
| `pnpm db:seed:dev` | 開発用ダミーデータの投入＋開発用ログインの有効化 |
| `pnpm db:studio` | Prisma Studio |

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | MariaDB接続。本番は `DB_*` から `scripts/construct-database-url.sh` が組み立てる |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth（他アプリと共有のプロジェクト） |
| `ALLOWED_GOOGLE_EMAILS` | 利用を許可するGoogleアカウント（カンマ区切り）。**未設定だと全員ログイン不可** |
| `ANTHROPIC_API_KEY` | チャットの返答生成に使うClaude APIのキー。**未設定だと送信が503で弾かれる**（画面は開く） |
| `SIGNALY_WEBHOOK_URL` | CI／デプロイ結果の通知先 |
| `CI_LOGIN_BYPASS_SECRET` | 開発用ログイン（Cookieバイパス）のシークレット。**本番には設定しない** |

変数名の一覧は `.env.example`、ローカルの記入例は `.env.local.example`、
デプロイ時の取得元は `.github/secrets-manifest.tsv` を参照する。

## 画面

| パス | 内容 |
|---|---|
| `/` | 新しい相談。最初の送信でスレッドが作られ `/c/<ID>` へ移る |
| `/c/<ID>` | 既存の相談スレッド |
| `/login` | ログイン |

チャットの返答は `POST /api/chat` がServer-Sent Eventsで逐次返す。相談は話題ごとの
スレッド（`Conversation`）に分かれるが、**対話相手は常に同じ「秘書」1人**で、相手を
選ぶ・切り替える導線は無い。

### 話す / 書く

相談画面には2つのモードがあり、ヘッダーの切り替えで行き来する。**既定は「話す」**で、
選んだモードはCookie（`aide-bot-talk-mode`）に1年残る。どちらで話しても同じスレッドへ
残るため、声で相談した内容も「書く」に切り替えれば文字で読み返せる。

| モード | 入力 | 出力 |
|---|---|---|
| 話す | マイク（`SpeechRecognition`・`ja-JP`） | 画面の字幕＋読み上げ（`speechSynthesis`） |
| 書く | キーボード | 画面のMarkdown表示 |

- 聞き取りと読み上げは**ブラウザ内蔵のWeb Speech API**で行う。音声を外部サービスへ送らない
  ため、追加のAPIキーも実費も要らない。代わりに**対応はChrome / Edge / Safariに限られる**
  （Firefoxは聞き取りに非対応）。使えない端末では画面に案内が出て「書く」へ寄せる
- 音声モードでは `POST /api/chat` に `mode: "voice"` を渡す。返答が読み上げ向きの短さになり、
  見出しや表を使わなくなる（`VOICE_STYLE_INSTRUCTION`）。保存の仕方は「書く」と同じ
- **マイクはHTTPS（またはlocalhost）でしか開けない**（secure context 限定）。**スマホ実機での
  確認に `sslip.io` は使えない**——http でしか開けず、画面は出るのにマイクが起動しない。
  Tailscale越しのHTTPSで開く

  ```bash
  # サブPCで一度だけ（Tailscale管理画面でHTTPS証明書を有効にしてある前提）
  tailscale serve --bg --https=443 24027
  # → iPhoneのSafariで https://subpc.<tailnet>.ts.net/ を開く
  ```

  `next.config.ts` の `allowedDevOrigins` に `**.ts.net` が入っているので追加の設定は要らない。
  片付けるときは `tailscale serve --https=443 off`

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、
成果物をVPSへ配ってPM2で再起動する。日常の開発は `develop`、本番反映は `develop` → `main` のPR。

## Issueごとのエージェント運用

`@claude` コメント起点の無人実行に対応している。運用ルールは [CLAUDE.md](CLAUDE.md) を参照。
