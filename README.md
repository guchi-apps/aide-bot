# aide-bot

NotionやAIDEなどを参照し、チャットボットでプライベートを補佐するPWA。

| 項目 | 値 |
|---|---|
| 本番URL | https://aide.gucchii.com/ |
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

## よく使うコマンド

| コマンド | 内容 |
|---|---|
| `pnpm dev` | 開発サーバー |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | 型チェック |
| `pnpm build:ci` | CIと同じビルド |
| `pnpm db:migrate:dev` | マイグレーション作成・適用（開発） |
| `pnpm db:studio` | Prisma Studio |

## 環境変数

| 変数 | 用途 |
|---|---|
| `DATABASE_URL` | MariaDB接続。本番は `DB_*` から `scripts/construct-database-url.sh` が組み立てる |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Auth（他アプリと共有のプロジェクト） |
| `ALLOWED_GOOGLE_EMAILS` | 利用を許可するGoogleアカウント（カンマ区切り）。**未設定だと全員ログイン不可** |
| `SIGNALY_WEBHOOK_URL` | CI／デプロイ結果の通知先 |

変数名の一覧は `.env.example`、ローカルの記入例は `.env.local.example`、
デプロイ時の取得元は `.github/secrets-manifest.tsv` を参照する。

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、
成果物をVPSへ配ってPM2で再起動する。日常の開発は `develop`、本番反映は `develop` → `main` のPR。

## Issueごとのエージェント運用

`@claude` コメント起点の無人実行に対応している。運用ルールは [CLAUDE.md](CLAUDE.md) を参照。
