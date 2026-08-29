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
- 返答の生成は `POST /api/chat`。使うモデルは設定の画面から選べる（後述「返答のモデル」）。
  Messages APIのストリーミングで叩き、Server-Sent Eventsで逐次返す
- **`ANTHROPIC_API_KEY` はモジュールの読み込み時に検証しない。** ビルド時にはこの値が無く
  （CIもActions上のビルドも持たない）、importの時点で投げると `next build` が落ちる。
  `getAnthropicClient()` の中で見る
- 履歴は毎回まるごと送り直すため、`HISTORY_LIMIT`（直近30発言）で頭を切る。上限を外すと
  長いスレッドほど1往復の入力トークンが際限なく伸びる。**ちょうど30発言で切るわけではない**
  （#56。理由は「プロンプトキャッシュ」を参照）
- **`Conversation.updatedAt` は発言を足しても動かない。** 一覧の並び順はこの列だけを見ている
  ので、発言を保存するときは同じトランザクションで `conversation.update` も呼ぶ
- 入力欄のEnter送信は `event.nativeEvent.isComposing` で必ず弾く。日本語入力の変換確定の
  Enterがそのまま送信になる

### 相談を消す（#102）

左メニュー（`ConversationRail`）の各行の右端にバツを置き、確認をはさんで
`DELETE /api/conversations/[id]` を叩く。

- **消えるのは発言（`Message`）だけ。** 使用量（`ApiUsage`）と書き込みの記録（`ToolCall`）は
  スキーマ側でSetNullにしてあり、相談との紐付けだけが外れて行は残る（#51・#81。消した相談ぶんの
  費用や、取り消せない書き込みをした事実まで消さないため）。**`/usage` の金額は減らない**
- **ただし `ToolCall` は行として残るだけで、画面からは辿れなくなる。** これを読んでいるのは相談の
  詳細（`src/app/(chat)/c/[id]/page.tsx`）だけで、`conversationId` がnullになった行を出す導線は
  どこにも無い。「Zaimに何を登録したか」を後から見る必要が出たら、まずこの一覧を作ること
- **消した相談のURL（`/c/<ID>`）へ着地したら `/` へ送る。** 相談を消せるようになったことで、
  この形のURLは初めて「実在しなくなるURL」になった。朝の見通し（#79）のWeb Pushは端末側の
  ペイロードにこのURLを持っており（`NotificationLog.conversationId` はFKの無いただの列なので、
  消した後も古い通知は同じURLを開く）、`not-found.tsx` の無いこのリポジトリでは**既定の404に
  着地して左メニューごと消え、アプリへ戻る導線が無くなる**
- **他人の相談をIDだけで消せないよう、`deleteMany` で `userId` ごと絞る。** 該当が0件なら404を
  返すので、存在しない場合と他人のものだった場合を区別せずに済む
- **バツを隠すかどうかは幅ではなくホバーの有無で決める**（`[@media(hover:hover)]:opacity-0`）。
  Tailwindの `group-hover:` は `@media (hover: hover)` の中にしか出ないため、`md:opacity-0` で
  隠すと**iPad（幅1180px・ホバー無し）ではバツが永久に出ない。** 幅の指定はPCとiPadを分けない
- **確認ダイアログはドロワー（`ChatShell` の z-50）より前に出す。** スマホでは一覧そのものが
  ドロワーの中にあるので、z-indexが同じだと確認が一覧の下に隠れる
- **開いている相談を消したら `/` へ戻す**（消えたページに取り残されて404になる）。スマホでは
  同時に `onNavigate()` でドロワーも畳む。それ以外は `router.refresh()` で一覧だけを取り直す

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

### プロンプトキャッシュ（#56）

履歴を毎回まるごと送り直す設計のまま、その前半をキャッシュから読ませる。入力ぶんの単価が
約1/10になり、最初の一言が出るまでの待ちも縮む。

- **キャッシュは前方一致。プレフィックスが1バイトでも変われば以降が全部無効になる。**
  したがって**履歴の窓を1発言ずつ滑らせてはいけない**。`HISTORY_LIMIT` を超えたスレッドで
  窓を毎回1つずらすと、往復のたびに先頭の発言が変わり、**キャッシュが一度も効かない。**
  窓の先頭は `HISTORY_WINDOW_STEP`（10発言）の刻みでしか動かさない（`historyWindowSkip()`）。
  代わりに送る発言は最大39件まで伸びるが、伸びたぶんはキャッシュ読みで乗るので毎回
  読み直させるより安い
- **並び順を決定的にする。** `createdAt` だけで並べると同時刻の発言で順序が揺れ、そこから
  後ろが丸ごとキャッシュミスになる。第2のキーに `id` を置く
- **ブレークポイントは2つ置く**（`src/app/api/chat/route.ts` の `cacheBreakpointIndexes()`）。
  今回の発言を除いた、新しい方から2つの**秘書の返答**に置く。1つは今回書き込む位置、もう1つは
  前回書き込んだ位置。1つだけだと、書いたキャッシュを次の往復が読む前にさらに先へ書き直す
  ことになり、読み出しが常に1往復ぶん手前で止まる。APIが受け付けるのは1リクエストにつき4つまで
- **発言の本文は常に `[{ type: "text" }]` の配列で渡す。** 印を付ける発言だけブロック配列に
  すると、同じ発言なのに往復ごとに送る形が変わる。前方一致が崩れる余地を残さない
- **システムプロンプトにはブレークポイントを置いていない。** 単体ではキャッシュできる最小の
  長さに届かず、置いても黙って無視される。履歴側のブレークポイントが前半まとめてを
  キャッシュするので、往復が続けばシステムプロンプトも一緒に乗る
- **キャッシュできる最小の長さはモデルごとに違い、世代順に単調ではない。** `claude-opus-5` は
  512トークン（Opus 4.8とSonnet 5は1,024、Opus 4.6とHaiku 4.5は4,096）。モデルを変えるときは
  この値も見る。下回るスレッド——始めたばかりの相談——では効かない。
  **利用者がモデルを切り替えられるようになった（#71）ので、この値は固定ではない。**
  `CHAT_MODELS`（`src/lib/chat-model.ts`）が `cacheMinimumTokens` として持ち、設定の画面が
  「安いモデルにしてもキャッシュが効かない場合がある」ことを注意書きに出している
- **「話す」と「書く」を行き来した往復ではキャッシュが切れる。** 体裁の指示がシステムプロンプトに
  入っており、モードが変わるとプレフィックスの先頭から変わるため。切り替えは頻繁ではないので
  そのまま受け入れている
- **効いたかどうかは `usage.cache_read_input_tokens` でしか分からない。** 何度呼んでも0のままなら
  前半に毎回変わる値が混じっている。**手元にAPIキーが無い環境では確かめられない**ので、
  スタブ（`ANTHROPIC_BASE_URL`）で確かめられるのは「送っているリクエストの形」までと割り切る

## 返答のモデル（#71）

返答の生成に使うモデルは、設定の画面（`/settings`）から**「話す」と「書く」で別々に**選ぶ。
選べるのは `claude-opus-5`・`claude-sonnet-5`・`claude-haiku-4-5` で、既定は両方 `claude-opus-5`。
単価そのものを下げられる唯一の手立てなので、消さないこと（入力トークンを減らす手当ては
プロンプトキャッシュ #56 と履歴の窓が担っている）。

- **モデルの定義の正は `src/lib/chat-model.ts`。** 選べるモデル・既定値・単価表・Cookie名を
  ここへ閉じてある。**このモジュールはクライアントコンポーネントからimportする**ので、
  PrismaやAnthropic SDKに触れるものを持ち込まないこと。Cookieの読み出しは
  `src/lib/chat-model-server.ts`（`next/headers` はサーバー専用で、importした時点で
  クライアント側のビルドが落ちる）
- **選んだ値はCookieに置く**（`aide-bot-chat-model-text` / `aide-bot-chat-model-voice`）。
  localStorageにしないのは、**サーバー側でも同じ値を読む必要がある**ため——返答を作るのは
  `/api/chat`（Route Handler）で、`/usage` の単価の注記もサーバー側で組み立てている
- **Cookieの値は必ず `normalizeChatModel()` を通す。** 利用者が書き換えられるので、そのまま
  APIへ渡すと存在しないモデル名で400になり、相談そのものが通らなくなる。知らない値は既定へ落とす
- **「話す」と「書く」で分けてもプロンプトキャッシュの効きは落ちない**（#56）。体裁の指示が
  システムプロンプトに入っており、2つのモードのプレフィックスは**もともと別々**。
  逆に、これ以上細かい単位（スレッドごと等）で切り替えられるようにすると、そのぶん
  プレフィックスが分かれてキャッシュが効かなくなる
- **音声モードを軽いモデルに寄せるのが費用と体感の釣り合いがよい。** 「話す」の返答は
  「3文以内・200文字以内」の指示と `VOICE_MAX_OUTPUT_TOKENS`（1200）で短く保たれており、
  いちばん高いモデルを充てても差が出にくい一方、費用はそのまま乗る
- **単価だけを見て選ばせない。** キャッシュが効き始める長さはモデルごとに違い、`claude-haiku-4-5`
  は4,096トークンから（`claude-opus-5` は512）。短い相談を何度も始める使い方では、単価の
  下げ幅ほど安くならない。設定の画面はこれを注意書きとして出している（`ModelPicker`）
- **モデルを増やすときは `CHAT_MODELS` と `MODEL_PRICING` の両方に足す。** 単価の行が無いモデルは
  使用量の画面で既定のモデルの単価で概算されてしまい、金額が黙って狂う。
  `cacheMinimumTokens` は世代順に単調ではないので、推測せず単価と一緒に調べ直すこと
- **`/usage` の注記に出るのは「これから使うモデル」**で、上の集計は呼び出した時点のモデルの
  単価で足し上げてある。切り替えた前後が混ざった記録は開発DBにも入れてある
  （`scripts/seed-ci-db.mjs` の `USAGE_MODELS`）

## プロアクティブ通知（#79）

**このアプリで唯一、利用者が開いていないときに動く仕組み。** 毎朝1回、AIDEから今の状況を取り、
秘書の言葉で短くまとめて端末へWeb Pushで届ける。押すとその相談が開き、そのまま続きを話せる。

配る先は**aide-bot自身のWeb Push**（#77で決定）。Signalyへ流す案を採らなかったのは、通知を
押した先がSignalyのPWAになり、**そこから秘書へ返事ができない**ため——「押して声で続けられる」
ことがこの機能の値打ちそのものなので、そこを削ると作る意味がほとんど残らない。

- **起動は外に任せる。** 常駐プロセスを足さず、`guchi-apps/vps` の `cron/crontab.txt` から
  `POST /api/briefing` を叩く（AIDEの `src/worker/run.ts` と同じ考え方）。認証は共有シークレットの
  Bearer（`BRIEFING_TRIGGER_TOKEN`）。**未設定なら経路ごと401で閉じる**——「未設定なら誰でも
  叩ける」にすると、設定漏れがそのまま公開エンドポイントになる
- **`public/sw.js` を置いたら `src/proxy.ts` のmatcherから必ず外す。** 除外パターンに `.js` は
  入っていないため、置いただけでは `/sw.js` がmiddlewareを通り、未ログイン時に `/login` への
  302がHTMLで返って `navigator.serviceWorker.register()` がMIMEタイプ違いで失敗する。
  `manifest.webmanifest` とまったく同じ失敗。**実際に `/other.js` は307で `/login` へ飛ぶ**ので、
  除外が効いているかはそれと見比べれば分かる
- **Service Workerは通知の受け取りだけを担う。** `fetch` ハンドラを持たず、画面もAPIも
  キャッシュしない。相談の内容は都度サーバーから取るもので、古い返答を出す方が実害が大きい

### 読まれなくなる通知を作らない

AIDEの `src/worker/notify.ts` が「成功を毎回送ると `zaim-keep-alive`（毎時）だけで1日24件になり、
肝心の失敗が埋もれる」という失敗を既にしている。**「定期的に教えてくれる」をそのまま実装すると
確実に読まれなくなる**ので、次を最初から入れてある。

- **決まった時刻に送るのは1日1本まで。** `NotificationLog` の一意制約 `(userId, kind, dedupeKey)`
  で守る。朝の見通しの `dedupeKey` は**日本時間の日付**（`jstDateKey()`）。サーバーのタイムゾーンで
  作ると、UTCで動く環境では日付の境目だけがずれて同じ日に2本出る
- **抑制は生成の前に見る。** cronが二重に登録されていても、2回目はAPIを1回も叩かずに戻る
- **知らせることが無ければ黙る。** モデルが `BRIEFING_SKIP_TOKEN`（`NO_BRIEFING`）だけを返した回は
  通知も相談も作らず、記録だけ残す。**黙れることがモデルを通す唯一の理由**——`aide_daily_briefing` は
  構造化JSONを返すので、定型文で組み立てるだけならAPI費用は0円で済む
- **生成に失敗した日は記録を残さない。** 残すと、直った後に叩き直しても抑制が効いてその日は
  二度と届かなくなる
- **通知の失敗で他を巻き込まない。** `sendPushToUser()` は例外を外へ出さず、1人が失敗しても
  他の利用者ぶんは続ける

### 実装で踏むところ

- **朝の見通しの相談は、1通目をUSERにする。** 秘書の返答を1通目にすると、続きを話しかけたときに
  `/api/chat` の `toPromptMessages()` が先頭のassistantを落として渡す（Messages APIはuserから
  始まる必要がある）ため、**肝心の見通しがモデルから見えなくなる。** 1通目には
  `MORNING_BRIEFING_REQUEST`——実際にモデルへ渡している依頼そのもの——を入れてあるので、
  画面に出しても嘘にならない
- **材料はすべてAIDE（MCP）から取る。** aide-botはMCPクライアントを実装していないので、
  繋いでいる接続が0件なら書けるものが何も無い。**API呼び出しの前に諦める**（費用だけ掛かって
  中身が空になる）
- **モデルは `BRIEFING_MODEL`（`src/lib/chat-model.ts`）。** 設定の画面からは選べない——選ぶ主体が
  居ない場面で使うためCookieを読めない。プロンプトキャッシュも効かない（1日1回では保持時間の
  5分をとうに過ぎている）
- **消費量は「API呼び出し1回＝`ApiUsage` 1行」**（#51）。`conversationId` は付かない
  （相談は生成が終わってから作るため）
- **書き込みの道具は設定によらず常に止める**（`toMcpRequestParts(servers, false)`。#78）。
  相談側は設定で渡せるが、朝の見通しは利用者のいないところで動いており、**登録の前に復唱して
  確かめる相手がいない。** 同じ理由で、システムプロンプトも相談用の `connectedServiceRules()` を
  使い回さず `briefingServiceRules()` を別に持つ（「尋ねられたら調べる」「復唱して確認する」は
  相手がその場にいる前提の指示）
- **VAPIDの公開鍵を `NEXT_PUBLIC_*` に置かない。** 公開鍵は本来公開してよい値で、VOICEVOX
  ENGINEのURL（#57）とは前提が違う。それでも置かないのは、**ビルド時にバンドルへ焼き込まれ、
  鍵を差し替えるたびに再ビルドが要る**ため。設定の画面（サーバーコンポーネント）が
  `pushPublicKey()` で読んでpropsで渡す
- **`web-push` はhttpsのendpointしか受け付けない。** ローカルで送信まで確かめるときは、
  自己署名証明書のhttpsスタブを立て、`NODE_TLS_REJECT_UNAUTHORIZED=0` を付けて開発サーバーを
  起こす。httpのスタブへ向けると `EPROTO ... wrong version number` で落ちる
- **送信の失敗はステータスコードだけをログに出さない。** DNS・TLS・接続拒否では `statusCode` が
  付かず「不明」としか残らない。原因はほぼ例外のメッセージ側にある
- **404 / 410 で返った購読はその場で消す。** 通知を切られた端末・ホーム画面から消されたPWAの
  購読は二度と復活せず、残すと毎朝失敗し続ける
- **iOSのWeb Pushは16.4以降、かつホーム画面に追加したPWAでのみ動く。** Safariのタブで開いて
  いるだけでは `PushManager` そのものが無い。設定の画面はこれを先に案内する（出さないと
  「通知が来ない」という不具合に見える）
- **通知を押しても自動では喋らない。** iOSは「画面を触った流れ」で一度 `speak()` を通さないと
  以降の読み上げが無音になり（「音声対話」参照）、通知のタップがその許可として使えるかは
  端末依存。**落としどころは「押すと該当の相談が開き、マイクを押せば続けられる」まで**にしてある

## お知らせの受け皿と、秘書の吹き出し（#93）

**各アプリが「利用者に知らせたいこと」を `Notice` へ積み、秘書が「話す」画面で待っている間に
1件選んで頭上の吹き出しに出す。** 選ぶのも文面を書くのもモデル（`src/lib/notices.ts`）。
朝の見通し（#79）と違い、材料を外部サービスへ取りに行かない——もう積まれている。

- **積む口はHTTPだけ**（`POST /api/notices`・共有シークレットのBearer。
  **`NOTICE_INGEST_TOKEN` 未設定なら経路ごと401**）。他アプリは同じMariaDBに同居しているので
  直接INSERTさせることもできるが、それをやると**このスキーマが外部の実装に固定され**、
  列を1つ足すたびに全アプリを直すことになる。宛先は `email`（`User.email` は一意）
- **未読が0件ならモデルを呼ばない。黙っている間の費用は0円。** これが「10分ごとに走る」を
  許容できる唯一の理由なので、候補が無くても定型文を出すような形へ変えないこと
- **黙った回（`NO_NOTICE`）も「叩いた」ものとして残す**（`lastRuns`。プロセス内のMap。
  PM2で1プロセスという前提は#48の `pendingGenerations` と同じ）。残さないと次の問い合わせで
  また叩き、**いちばん起こりやすい「知らせることが無い」場面で費用が10倍になる**
- **選び直すのは10分に1回まで。ただし、まだ一度も候補に入れていない急ぎ（`URGENT`）が
  積まれた回だけ1分まで詰める。** 画面側（`use-notice.ts`）は1分ごとに問い合わせるが、
  **そのほとんどはDBを引くだけで戻る**。頻度を上げてよいのはこの造りのため
- **一度出した行は二度と候補にならない**（`shownAt`）。`ingestNotice()` のupsertは
  出した行を未読へ戻さない。戻すと同じ話が何度でも吹き出しに出る
- **モデルの返答は1行目が「番号（＋`URGENT`）」、2行目が吹き出しに出す文。**
  知らない形で返ってきた回は**黙る**（`parseChoice()` が null）。無理に読み取ると、前置きの
  一文がそのまま吹き出しに出たり、番号として読めないものを0番と見なして関係の無いお知らせを
  消費したりする。生成に失敗した回は `lastRuns` にも残さず、次の問い合わせでやり直す
- **出した吹き出しは60分で引っ込める**（`NOTICE_DISPLAY_TTL_MS`）。残し続けると、朝に選ばれた
  お知らせが夜まで頭上に居座り、いま知らせている内容だと誤解される
- **開きっぱなしのタブへの錠は2つ。** 画面が見えている間だけ動かすことと、1時間触られなければ
  休むこと（`IDLE_LIMIT_MS`）。前者だけでは、サブディスプレイに置いた画面が丸一日ぶんの
  生成を回す
- **モデルを叩かない問い合わせもただではない。** `/api/*` はRoute Handlerが自分で認証するが、
  **middlewareは素通しの判定より前に必ず `auth.getUser()` を通す**（`src/lib/supabase/middleware.ts`）
  ため、問い合わせ1回ごとにSupabaseへ1往復増える。Supabaseは他アプリと共有のプロジェクトで、
  レート制限もそちらに効く。`POLL_INTERVAL_MS` を縮めるときはここを見ること
- **aide-bot自身が最初の「積む側」になっている。** 朝の見通し（#79）が通知を送った回は、
  同じ一言を `Notice` へも積む（`src/lib/briefing.ts`）。受け皿と投入口だけでは、繋いだアプリが
  積みに来るまで吹き出しは黙ったままになる。**AIDEから材料を取れる経路はここだけ**
  （aide-botはMCPクライアントを実装していない）
- **吹き出しにエラーを出さない。** 通信も生成も、失敗した回はログにだけ残していまの表示を
  続ける。状況を知らせる場所が小言で埋まると読まれなくなる（#79と同じ理由）
- 開発DBにはダミーのお知らせを入れてある（`scripts/seed-ci-db.mjs` の `NOTICE_SEEDS`）。
  **未読が0件だと吹き出しは正しく黙る**ので、空のままでは実装が効いているのか材料が無いだけ
  なのかを画面から切り分けられない

### 吹き出しそのもの（`src/components/voice/speech-bubble.tsx`）

- **1つの吹き出しが2つの役目を担う。** 待っている間は選ばれたお知らせ、往復の最中はいまの状態
  （聞いています・考えています…）。分けないのは置ける場所が絵の真上の1か所しかないためで、
  2つ並べるとスマホ（393×852）で絵か字幕のどちらかが押し出される
- **状態の文言は「秘書が喋っている形」にする**（「待っています」ではなく
  「どうぞ、話しかけてください」）。`aria-live="polite"` はこの文字列をそのまま読む
- **出す文字列をそのまま `key` に渡している。** 中身が変わるとReactが要素を作り直し、
  出てくる動き（`bubble-pop`）が頭から再生される。動きは `globals.css` の `.bubble-*` /
  `.ind-*` に置く（`.bot` と同じ理由）。**続く動きは1つの `animation` へまとめて書く**——
  クラスを重ねると後から当てた方に丸ごと上書きされる
- **`aria-live="polite"` は、その外側の作り直されない要素に置く。** 吹き出し本体と同じ要素へ
  置くと、`key` で作り直したときに支援技術からは「中身が変わった」ではなく「新しい領域が
  現れた」に見え、読み上げられないことがある
- **置き場所の高さは先に取っておく**（`min-h-[74px]`）。文言の長さで背が変わると、下の絵と
  字幕が上下する

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
- **単価表は `src/lib/chat-model.ts` の `MODEL_PRICING`**（#71で `src/lib/usage.ts` から移した。
  モデルを選ぶ画面がクライアントコンポーネントで、単価をバッジに出すため）。Anthropicが単価を変えたらここを直す。
  呼び出した時点のモデル名で引き直すため、使うのをやめたモデルの行も消さない。画面に出るのは
  概算で、実際の請求額ではない（円は `USD_JPY_RATE` の固定レートでの参考値）
- **`inputTokens` はキャッシュに載らなかった残りだけを指す**（#56）。入力ぶんの合計は
  `inputTokens + cacheReadTokens + cacheWriteTokens`。この列だけを「入力」として画面に出すと、
  同じだけ送っているのに使用量が激減したように見える。画面へ出すときは `promptTokens()`
  （`src/lib/usage.ts`）で合計を作り、うちキャッシュから読んだぶんを内訳として添える
- **`src/lib/usage.ts` はサーバー専用。** Prismaを引き込むため、クライアントコンポーネントから
  importしない。`/usage` の画面
  （`src/components/chat/usage-view.tsx`）は数字を見るだけなのでサーバーコンポーネントのまま置いている

## 音声対話（話す / 書く）

**このアプリの本来の使い方は音声**で、文字入力は声を出せない場面と言い直しのために残している（#27）。
どちらのモードでも同じ `Conversation` へ残り、`POST /api/chat` も共通。既定は「話す」で、
選んだモードはCookie `aide-bot-talk-mode`（`src/lib/talk-mode.ts`）に持つ。

- **聞き取りはブラウザ内蔵のWeb Speech APIだけで行う**（`src/lib/speech/`）。
  音声を外部へ送らないので追加のAPIキーも実費も無い。対応はChrome / Edge / Safariに限られ、
  **Firefoxは聞き取りに非対応**。使えない端末には案内を出して「書く」へ寄せる。
  外部STTへ寄せる判断をするときは、依存とキーと実費が増えることをIssueで先に確認する
- **1回の聞き取りは、話し始めないまま数秒経つと `no-speech` で勝手に終わる**（#67）。
  そこで待機へ戻すと、「続けて話す」で自動的に開いたマイクが、利用者が話し出す前に
  閉じたきりになる——**画面は待機のまま（吹き出しは「どうぞ、話しかけてください」）で、
  話しかけても何も起きない。**
  `no-speech` は文言を出さない扱いなので、エラーの手掛かりも残らない。何も聞き取れないまま
  閉じたぶんは `VoicePanel` が開き直す（`SILENT_RESTART_LIMIT` 回まで）。
  **開き直さないのは、利用者自身が閉じたとき・文言付きのエラーで終わったとき**
  （マイクが許可されていない等。開き直しても同じところで失敗する）
- **新しい相談の1通目では、`/c/<ID>` への移動でこの画面が作り直される**（#67）。
  ルートをまたぐ移動なのでReactは `VoicePanel` を作り直し、**送信の後も続いている読み上げと、
  「続けて話す」で開いたばかりのマイクが巻き添えで畳まれる。** `useChatStream` の
  `deferNavigation` で移動を預かり、待機に入ってから `flushNavigation()` で移る。
  **「書く」へ切り替えるときも消化する**——`/` のままだと新しい相談として開いてしまう
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
  **サブPCのTailnet HTTPS証明書は有効済み**（#32で管理画面から有効化した。`tailscale status --json`
  の `CertDomains` に `subpc.<tailnet>.ts.net` が入っている）。以前ここには「未有効」と書いてあり、
  #57 で実際に確かめて訂正した。**判断の前に `tailscale status --json | jq .CertDomains` を見ること**
  （`null` なら未有効で、管理画面での有効化が要る）

## 外部サービスとの接続（MCP）

秘書が相談の中でAIDEやNotionのデータを引けるようにする仕組み（#46）。**MCPクライアントは
実装していない。** Messages APIのMCPコネクタがAnthropic側でリモートMCPサーバーへ繋ぎ、
ツールも向こうで実行する。aide-botが持つのは「どこへ・どの資格情報で繋ぐか」だけ
（`src/lib/mcp/`・`prisma` の `McpConnection`）。

- **繋ぎ先は「公式のリモートMCPサーバーがあるものは直接、無いものはAIDE経由」で分ける。**
  Googleカレンダー・GmailはClaudeアプリ側のコネクタで、APIから叩ける公開URLが存在しない。
  この手のサービスはAIDE（`guchi-apps/aide`）へコネクタとツールを足し、AIDEの1接続にまとめる。
  逆にNotionのように公式のリモートMCPがあるものをAIDEへ載せてはいけない
  （AIDEの「公式MCPと重複するツールをMCP層に出さない」方針とぶつかる）
- **`mcp_servers` だけでは400になる。** サーバーの定義と、それを指す `mcp_toolset` が
  `tools` 側にも要り（1サーバーにつきちょうど1つ）、ベータ指定 `mcp-client-2025-11-20`
  （`MCP_BETA`）も要る。3つのうちどれが欠けても弾かれる
- **接続が0件のときはベータもツールも渡さない。** 従来どおりのリクエストに戻し、
  ベータの都合で普段の相談が影響を受けないようにしてある
- **`max_tokens` にはツール呼び出しのぶんも乗る。** 特に音声モードの1200は本文を短く保つ
  ための値なので、繋いでいるときは `MCP_TOKEN_ALLOWANCE` を足す。足さないと、ツールを
  2回呼んだだけで本文へ回るぶんが尽きる
- **長く掛かった回は `pause_turn` で一度返ってくる。** そこまでの `content` をassistantの
  発言として足し、続きを頼み直す（`MAX_TURNS` 回まで）。1回で終わる前提で書くと、
  ツールを何度も呼んだ回だけ返答が途中で切れる
- **保存するのは本文だけ。** ツールの呼び出しと結果は履歴に残さないので、次の往復では
  ふつうのuser/assistantの並びに戻る。宙に浮いた `tool_use` が残らない。
  **`Message` に残さないだけで、記録そのものを捨てているわけではない**（#81。後述
  「書き込みの記録」を参照）
- **`pause_turn` で頼み直した往復は、APIを叩いた回数ぶん `ApiUsage` の行ができる**（#51の
  「1呼び出し＝1行」をそのまま守る）。1発言＝1行だと思って読むと、使用量の画面が
  実際より多く見える
- **`betas` はリクエストの本文には入らない。** SDKが `anthropic-beta` ヘッダーへ移すため、
  スタブ（`ANTHROPIC_BASE_URL`）で送信内容を確かめるときは**ヘッダーも記録しないと、
  ベータ指定が抜けているように見える**（#61で実際に一度そう見えた）
- **繋ぐとプロンプトキャッシュ（#56）の効きが落ちる。** キャッシュの前方一致は
  `tools` → `system` → `messages` の順で並んだ全体に掛かり、ツール定義はその先頭側に載る。
  接続を足す・外す・アクセストークンを更新した往復では、そこから後ろが全部書き直しになる。
  履歴側のブレークポイントの置き方は変えていない（接続の増減は日常的には起きないため）
- **アクセストークンはDBに平文で持つ。** 同一VPS・利用者1人という前提と、接続先である
  AIDE自身が `data/auth/` に平文で持っていることに合わせた（#46で相談のうえ決定）。
  暗号化するとシークレットが1つ増え、1Passwordと本番設定の手作業が発生する
- **認可のコールバック（`/api/connections/callback`）はログイン判定を挟まない。**
  相手の認可画面を経由して戻る経路で、手掛かりは `state` だけになる。こちらが発行して
  DBへ保存した使い捨ての値なので、当たった行の利用者以外は書き換えられない
- **`.well-known` はパスを差し込む形と差し込まない形の両方を試す。** 仕様は
  `https://example.com/.well-known/oauth-protected-resource/mcp` と定めているが、
  パス無しでしか出していない実装がある
- **開発DBのダミー接続は、相談に渡らない状態で入れてある**（`scripts/seed-ci-db.mjs`）。
  使えるトークンを持った接続を入れると、開発環境で相談を送るたび実在しない資格情報で
  外部へ繋ぎに行き、返答の生成そのものが失敗する

### 書き込みの道具（#78）

繋いだサービスの道具には、**あとから取り消せない結果が残る**ものがある
（AIDEの `aide_zaim_payment` はツールの説明文に「この経路から取り消し・修正はできない」と
明記されている）。#46 の時点では絞り込みが無く、**全ての相談・両方のモードへそのまま渡っていた。**

- **`mcp-client-2025-11-20` に `allowed_tools` は無い**（前の版 `mcp-client-2025-04-04` の書き方）。
  絞り込みは `mcp_toolset` の `default_config`（全体の既定）と `configs`（道具ごとの上書き）で、
  どちらも `{ enabled, defer_loading }` しか持たない。**書き込みを止めるのは
  `configs: { <道具名>: { enabled: false } }`**（`toMcpRequestParts()`）
- **止める道具の名前の正は `MCP_PRESETS` の `writeTools`**（`src/lib/mcp/presets.ts`）。
  名指しで止める形なので、**挙げ漏らした道具はそのまま渡る。** 逆向き（取得系だけを名指しで
  許す）にしないのは、接続先が取得系を1つ足すたびにこちらを直すまでその道具が使えなくなるため。
  **取りこぼしても壊れない側へ倒してある**ので、「絞り込んだから安全」と見なさないこと
- **Notionの `writeTools` はあえて空にしてある。** 手元にAPIキーが無く、実在する道具名を
  実物で確かめられないため。設定の画面は**絞り込めない接続をそのまま名指しで出す**
  （`WriteToolPicker`）。ここを黙らせると、絞り込めていない接続まで止まっていると誤解される
- **既定は「渡さない」**（`DEFAULT_WRITE_TOOL_POLICY`）。とりわけ「話す」が危なく、聞き取った
  文字列はそのまま発言として送られるので、金額や店名の聞き間違いが取り消せない記録になりうる。
  設定は Cookie `aide-bot-mcp-write-tools` に持ち、`off` / `text`（「書く」のときだけ）/ `on` の3つ。
  **知らない値は `off` へ落とす**——利用者が書き換えられる値なので、そのまま判定へ回すと
  書き換えるだけで書き込みが開く
- **定義は `src/lib/mcp/write-tools.ts`（クライアントからimportする）とCookieを読む
  `write-tools-server.ts` に分ける**（返答のモデル #71 と同じ分け方。`next/headers` は
  importした時点でクライアント側のビルドが落ちる）
- **「登録の前に復唱して確認を取る」指示は、繋いでいれば常に置く**（`connectedServiceRules()`）。
  絞り込めるのは名前を把握している接続先だけなので、設定で止めたことを安全の根拠にしない
- **止めたことをシステムプロンプトで伝える。** 伝えないと、道具が見当たらないまま
  「登録しておきました」と答えてしまう
- **設定を変えるとプロンプトキャッシュ（#56）が切れる。** `tools` も `system` も変わるため。
  日常的に切り替えるものではないのでそのまま受け入れている

### 書き込みの記録（#81）

**取り消せない書き込みを実際に行ったときだけ、その1回を `ToolCall` の1行として残す。**
#78 で「既定では渡さない・渡すときは復唱して確認を取る」ようにしたが、渡したうえで書き込んだ
ときに**何を登録したのかが aide-bot 側に残らない**という懸念はそのままだった。返答の本文に
書かれていなければ、接続先（Zaim・GitHub）の画面を見に行くしかなかった。

- **`Message` ではなく別のテーブルに置くことで #46 と両立させている。** 履歴を組み立てる
  `toPromptMessages()`（`src/app/api/chat/route.ts`）は `Message` しか読まないので、記録を
  増やしてもモデルへ渡すリクエストの形は1バイトも変わらない——宙に浮いた `tool_use` は
  発生せず、プロンプトキャッシュ（#56）の前方一致にも影響しない
- **残るのは `MCP_PRESETS` の `writeTools` に挙げた道具だけ**（#78の絞り込みと同じ表を引く）。
  **挙げ漏らした道具は渡るのに記録にも残らない**ので、「記録に無い＝書き込んでいない」とは
  読めない。止める側と残す側で表を分けないこと——片方だけに足すと、渡っているのに記録
  されない道具ができる
- **`createdAt` には呼んだ時点の時刻を明示的に入れる。** 行を作るのは返答を保存した後なので、
  既定の `now()` に任せると**相談の画面で秘書の返答より後ろに並ぶ**。画面側
  （`src/app/(chat)/c/[id]/page.tsx` の `mergeEntries()`）は `Message` とこの列を時刻順に
  混ぜて1本にしている
- **引数は `input_json_delta` で刻まれて届く。** `content_block_start` の `mcp_tool_use` に
  載っている `input` は空のことがあり、そこだけ見ていると**記録に残るのは道具の名前だけ**に
  なる。逆に結果（`mcp_tool_result`）は `content_block_start` に丸ごと乗る
- **内容ブロックの番号（`index`）は1メッセージの中でしか通じない。** `pause_turn` で頼み直した
  続きでは0から振り直されるため、`message_start` で対応表を捨てる。捨てないと前のメッセージの
  呼び出しへ引数を継ぎ足す。結果の突き合わせは `tool_use` のIDで行う（こちらはまたいでも変わらない）
- **記録に失敗しても相談は止めない**（#51と同じ）。書き込みは独立したtry/catchに置き、失敗は
  ログにだけ残す
- **遮られて結果が届かなかったぶんは `output` がnullのまま残る。** これは「書けていない」では
  なく「確かめられていない」——画面も「結果は未確認」と出す。埋め合わせの推定はしない。
  実測でも、1文字も返らないうちに割り込んだ往復で `Message` は作られないのに `ToolCall` は
  残った（この状況こそ辿れる必要がある）
- 画面に並ぶものは `ChatEntry`（`src/components/chat/types.ts`）。発言（`ChatMessage`）と
  記録（`ChatToolCall`）の判別可能なユニオンで、「話す」「書く」の両方が同じ配列を並べる。
  生成中はSSEの `record` イベントで先に足す（`tool` イベントは従来どおり「いま調べています」の
  一瞬の表示で、こちらは残らない）

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

### 聞き取りをマイク無しで確かめる

**`window.SpeechRecognition` を差し替えれば、マイクの無いサブPCでも「話す」の往復を丸ごと
動かせる**（#67）。ヘッドレスChromeを `--remote-debugging-port` 付きで起こし、CDPの
`Page.addScriptToEvaluateOnNewDocument` で偽の `SpeechRecognition`（`start()` の回数を数え、
`no-speech` → `end` を返すだけ）を仕込んでから開く。開発用ログインのCookieは
`Network.setCookie` で渡せる。声の設定はlocalStorage（`aide-bot-voice-settings`）に
先に書いておけば効く。

`[aria-live="polite"]`（秘書の頭上の吹き出し。#93）の文言と `start()` の回数を一定間隔で
読むだけで、**開き直しているか・どこで畳まれたかが分かる。** 待機中は
「どうぞ、話しかけてください」、聞き取り中は「聞いています」。**待機中に読み取れるのは
状態の文言とは限らない**——積まれたお知らせがあればそちらが出る（#93）。
Playwrightは要らない（Node 22以降の `WebSocket` でCDPへ直接繋げる）。

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

### ホバーで出る要素を確かめる（#102）

**ヘッドレスChromeは既定で `hover: none` を返し、`Emulation.setEmulatedMedia` では変えられない。**
`features: [{ name: "hover", value: "hover" }]` を渡しても `matchMedia("(hover: hover)").matches` は
`false` のままで、**PCでの見え方を一度も再現できない**（`prefers-color-scheme` などは効くので、
効いていないことに気付きにくい）。PC側を確かめるときは起動フラグで固定する。

```bash
chrome-headless-shell --headless --disable-gpu --no-sandbox --remote-debugging-port=9333 \
  --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 \
  about:blank
```

ホバー中の見た目はCDPの `CSS.forcePseudoState`（`forcedPseudoClasses: ["hover"]`）で作る。
`Input.dispatchMouseEvent` で座標へ動かすより確実。**ホバーの無い端末（iPad・スマホ）は
既定のまま起こせばよい**ので、この2つを起こし分ければ「乗せたときだけ出る」を両側から確かめられる。

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

### CIのチェックが `queued` のまま完了しないとき（#85）

**GitHub Actions側の障害中に作られたrunは、ジョブが1つも作られないまま壊れる。**
runそのものは `completed` / `failure` になるのに、`lint-and-build` の**check runだけが
`queued` のまま永久に残る**。`develop` の必須チェックはこの1つだけなので、PRは
`mergeStateStatus: BLOCKED` から動かなくなり、レビューも自動マージも「CI待ち」で止まる。
2026-08-26のActions障害（15:11〜18:01 UTC。DBのプライマリ障害）でPR #84がこの状態になった。

- **見分け方は「runは終わっているのにジョブが0件」**。ログが無いので `--log-failed` では何も出ない

  ```bash
  gh api repos/guchi-apps/aide-bot/actions/runs/<runID> --jq '{status, conclusion}'   # completed / failure
  gh api repos/guchi-apps/aide-bot/actions/runs/<runID>/jobs --jq .total_count        # 0
  gh api repos/guchi-apps/aide-bot/commits/<PRのheadSHA>/check-runs \
    --jq '.check_runs[] | select(.status != "completed") | .name'                     # lint-and-build
  ```

- **`gh run rerun` はCIを走らせ直さない。ブロックだけを外す。** 壊れたrunのレコードを
  再利用するため、再実行しても `run_attempt` は1のままジョブが作られない（#85で25分待って
  0件を実測）。**一方で、再実行した時点で古いcheck runがheadのSHAから消える。**
  必須チェックが「Queuedのまま」ではなく「存在しない」状態になるので、**PRのブロックは
  外れる**——#85では再実行の約23分後に、15:33の時点で有効化されていたAuto-mergeが
  そのままPR #84をマージした。**CIが通ったのではなく、チェックごと消えて通り抜けた**ので、
  これに頼るなら中身は別の手段で検証しておくこと
- **CIを実際に走らせたいなら新しいrunを作る。** `workflow_dispatch` を足してあるので、
  まずこれを使う。check runはブランチ先端のSHA（＝PRのhead）に付くため、必須チェックも満たせる

  ```bash
  gh workflow run ci.yml --repo guchi-apps/aide-bot --ref issue-<番号>
  ```

- それでも駄目なら**PRをclose → reopen**する（`pull_request: reopened` でCIが走る）。
  空コミットのpushでも直るが、**他Issueのブランチを書き換えることになるので最後の手段**
- **障害の窓に入ったrunは他のワークフローにもある。** `Issue Labels` などが `queued` のまま
  居座っていても実害は無いが、`gh api ".../actions/runs?status=queued"` で範囲を把握しておくと
  「今も壊れているのか、当時のものが残っているだけか」を切り分けられる

無人実行のたびに `.shared-context/`（共有知識）と `.shared-prompts/`（issue-deck側の
実装プロンプト）がワークツリーへcheckoutされる。**どちらもこのリポジトリの管理対象ではない。**
`.gitignore` 済みなので、**編集・`git add`・コミットを一切行わないこと。**
