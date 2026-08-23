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

## 検証コマンド

```bash
pnpm lint        # ESLint
pnpm typecheck   # tsc --noEmit
pnpm build:ci    # prisma generate && next build
```

CI（`.github/workflows/ci.yml`）はこの3つを実行する。ビルドは外部サービスへ接続しないため、
`DATABASE_URL` と `NEXT_PUBLIC_SUPABASE_*` はCI専用のプレースホルダーでよい。

## ローカル開発

```bash
pnpm install
pnpm env:init            # .env.local.example を .env.local へコピーして編集する
pnpm db:setup            # .env.local の DATABASE_URL から DB・ユーザーを作成する
pnpm db:migrate:dev
pnpm dev                 # http://localhost:3000
```

Supabase の Redirect URLs に、開発で使うオリジンの `/auth/callback` を登録しておく必要がある。

## デプロイ

`main` へのpushで `.github/workflows/deploy.yml` が動く。GitHub Actions側でビルドし、成果物を
VPSへ配ってPM2で再起動する（VPS上で `next build` はしない。メモリが足りないため）。

**デプロイに必要な値の取得元は `.github/secrets-manifest.tsv` が正**。ワークフローの `env:` ブロックは
`scripts/generate-workflow-env-block.sh` で生成する。1Passwordは「人が管理する唯一の正」として残り、
値を変えたときだけ `scripts/sync-github-secrets.sh` でGitHubへ同期する
（実行時に1Passwordを読まない理由は guchi-apps/issue-deck#1302・#1307）。

---

# Issueごとの複数Claude Codeエージェント運用

`@claude` コメントを起点に、計画提示〜実装〜develop向けPR作成〜レビュー〜マージまでをGitHub Actions上で
無人実行する運用を導入している。仕組みの本体は `guchi-apps/issue-deck` にあり、aide-botはその
再利用可能ワークフロー（`workflows/v25` タグ）を参照する側として構成している。

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
| `24.screenshot-required` | PR作成前にスクリーンショットで確認し、承認を得る。**無人実行では現状使えない**（全画面がSupabase Auth + Google OAuthの背後にあり、CIログインバイパスもPlaywright依存も無いため） |
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

すべてissue-deckの再利用可能ワークフローを `@workflows/v25` で参照する薄いcallerで、
ジョブ本体はこのリポジトリに持たない。

| ファイル | 内容 |
|---|---|
| `issue-labels.yml` | 進捗（Project Status）の報告 |
| `claude-issue-dispatch.yml` | `@claude` 起点の計画・実装・PR作成 |
| `claude-review-develop.yml` | develop向けPRの自動レビュー・リスク判定・Auto-merge |
| `claude-conflict-resolve.yml` | developとのコンフリクト自動解消 |
| `claude-ci-fix.yml` | CI失敗の自動修正 |
| `claude-pr-repair.yml` | Issueに紐づかないPRの修復（画面のボタンから起動） |
| `release-develop-to-main.yml` | バージョンbump PR・develop→mainのリリースPR作成 |
| `version-tag-check.yml` | main宛PRでのリリースタグ重複・デプロイ設定漏れの検査 |

**参照しているタグは正ではない。** 上げたらこの表も直すが、実態は `.github/workflows/` の
`uses:` を見るのが確実。**`uses:` のタグと `prompts-ref` は必ず同じ値にする**
（片方だけ上げると新しいワークフローで古いプロンプトが動く）。

### callerに書ける `with:` は、参照しているタグ時点の再利用ワークフローが持つ入力だけ

**存在しない入力を渡すと `startup_failure` になる。** ジョブが1つも作られず、ログも残らないため
原因が分かりにくい。タグを上げるときも、増やした入力がそのタグに実在するかを確かめる。

実際に踏んだ形（aide-bot#1）。`workflows/v25` 時点で次の2つがある。

- **`database-name` を受け取るのは `reusable-issue-dispatch.yml` だけ。**
  `reusable-claude-ci-fix.yml`・`reusable-claude-conflict-resolve.yml` には無い。
  DBを使うリポジトリで揃えたくなるが、渡してはいけない
- **`reusable-deploy-retry.yml` は `workflows/v25` に存在しない**（issue-deckのdevelopにはある）。
  そのため `deploy-retry.yml` のcallerは置いていない。入れるのは、これを含むタグへ上げてから

確認は次のコマンドでできる（issue-deckのチェックアウトが手元にある場合）。

```bash
cd ~/apps/issue-deck
git show workflows/v25:.github/workflows/reusable-claude-ci-fix.yml | awk '/^  workflow_call:/,/^jobs:/'
```

無人実行のたびに `.shared-context/`（共有知識）と `.shared-prompts/`（issue-deck側の
実装プロンプト）がワークツリーへcheckoutされる。**どちらもこのリポジトリの管理対象ではない。**
`.gitignore` 済みなので、**編集・`git add`・コミットを一切行わないこと。**
