#!/usr/bin/env node
// 開発／CI用のダミーデータを投入する。
//
// 共有ワークフロー（issue-deckのreusable-issue-dispatch.yml）が `db:seed:ci` という
// 名前で `--if-present` 付きで呼ぶ。**スクリプト名を変えると無言でスキップされる。**
// ローカルからは `pnpm db:seed:dev`（scripts/seed-dev-db.sh）が接続先を確かめてから呼ぶ。
//
// ここで作るユーザーは、開発用ログイン（#25）で入るバイパス対象のダミーユーザー。
// supabaseUserId の値は src/lib/ci-auth-bypass.ts の CI_BYPASS_SUPABASE_USER_ID と
// **必ず一致させること**（プレーンJSのスクリプトのためTSファイルを直接importせず、
// 値をこのファイルに直書きしている）。一致していないと、ログインは通るのに
// getCurrentUser() がnullを返し、画面が /login へ戻り続ける。

import { createHash } from "node:crypto";

import { PrismaClient } from "@prisma/client";

const CI_BYPASS_SUPABASE_USER_ID = "ci-screenshot-bot";

// 相談のダミーの記録に使うモデル名（#128・#133）。**Codexのモデル名にしてある。**
// 使用量の画面はモデル名から課金の形を決める（src/lib/chat-model.ts の billingKind）ので、
// ここをClaudeのままにすると、相談のぶんが従量課金の節へ入って費用が付く。
//
// 返答のモデルは設定の画面から切り替えられる（#71）。**切り替えた前後が混ざった記録**を
// 入れておかないと、モデルごとに集計を引き直せているかを画面で確かめられない。
const USAGE_MODELS = ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
const USAGE_MODEL = USAGE_MODELS[0];

// 朝の見通し（#79）のモデル。**いま従量課金の節に入るのはこれだけ**（src/lib/chat-model.ts の
// BRIEFING_MODEL と揃える）。片方だけ変えると、画面の節が空になって気付けない。
const BRIEFING_USAGE_MODEL = "claude-haiku-4-5";

/**
 * API呼び出し1回ぶんのダミーのトークン数（`ApiUsage` の1行）。
 *
 * 履歴は毎回まるごと送り直すため、同じスレッドでは往復を重ねるほど入力ぶんが増える。
 * 画面で内訳を見たときに不自然にならないよう、その形に寄せてある。
 *
 * **キャッシュ読みを必ず入れてある。** Codexは自前の指示文を毎回前置きするため、実測でも
 * 入力の大半（12,000のうち8,960）がキャッシュ読みで、カードの「入力のうち N はキャッシュから」が
 * 常に出る。0のままにすると、その行が出ているかを画面から確かめられない。
 */
const dummyUsage = (turnIndex, createdAt, userId, model = USAGE_MODEL) => ({
  // Conversation配下のネストで作るためconversationIdは省けるが、userIdは自分で繋ぐ必要がある。
  user: { connect: { id: userId } },
  model,
  inputTokens: 3200 + turnIndex * 2600,
  outputTokens: 540 + turnIndex * 160,
  cacheWriteTokens: 0,
  cacheReadTokens: 8960,
  createdAt,
});

const db = new PrismaClient();

// ダミーの相談。一覧の見出し（今日 / 今週 / それ以前）が分かれて見えるよう、
// 更新時刻を散らしてある。基準時刻は実行時のnow。
const now = new Date();
const daysAgo = (days) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

const CONVERSATION_SEEDS = [
  {
    title: "引っ越しの段取りを整理する",
    startedAt: daysAgo(0),
    messages: [
      "来月の頭に引っ越すんだけど、やることの抜けがないか整理したい。単身で、いまの部屋は賃貸。",
      [
        "期日が決まっているものから片づけると抜けにくいです。",
        "",
        "#### 先に日付を押さえるもの",
        "",
        "- **解約の連絡** — 多くの賃貸契約は**退去の1か月前まで**。契約書の「解約予告期間」を今日中に確認してください",
        "- **引っ越し業者の予約** — 月初は繁忙期に当たりやすいので、日程が決まった時点で押さえる",
        "- **電気・ガス・水道の停止／開始** — ガスの開栓は立ち会いが要るため、当日の枠を先に取る",
        "",
        "#### 役所での手続き",
        "",
        "| 手続き | いつ |",
        "|---|---|",
        "| 転出届 | 引っ越しの14日前から |",
        "| 転入届 | 引っ越し後14日以内 |",
        "| マイナンバーの住所変更 | 転入届と同時に済ませられます |",
      ].join("\n"),
      "1Kで、大物は洗濯機と冷蔵庫くらい。",
    ],
  },
  {
    title: "今月の食費が想定より多い件",
    startedAt: daysAgo(3),
    messages: [
      "今月の食費が予算より1万円ほど多い。どこを見ればいい？",
      "内訳を「外食」「中食（惣菜・弁当）」「自炊の材料費」の3つに割ってみてください。どれが伸びたかで打ち手が変わります。まとめて減らそうとすると続きません。",
    ],
  },
  {
    // 書き込みの道具を使った記録（#81）が画面でどう見えるかを確かめるための1本。
    // 成功した回と失敗した回の両方を、同じ流れの中へ混ぜてある。
    title: "コンビニの支払いを記録しておく",
    startedAt: daysAgo(2),
    messages: [
      "さっきファミマで1250円使った。家計簿に入れておいて。",
      "ファミリーマートで1250円、食費として今日の日付で登録しました。",
      "あと昨日のカフェの680円も。",
      "登録しようとしましたが、家計簿側で弾かれました。もう一度お試しいただけますか。",
    ],
    // 秘書の返答（奇数番目の発言）の直前に置く。実際の並びと同じにするため、
    // 発言の時刻の1秒前を呼び出しの時刻にしてある。
    toolCalls: [
      {
        afterMessageIndex: 0,
        serverLabel: "AIDE",
        serverSlug: "aide",
        toolName: "aide_zaim_payment",
        input: JSON.stringify({
          amount: 1250,
          place: "ファミリーマート",
          category: "食費",
          date: "2026-08-24",
        }),
        output: "登録しました（money_id: 98765）",
        failed: false,
      },
      {
        afterMessageIndex: 2,
        serverLabel: "AIDE",
        serverSlug: "aide",
        toolName: "aide_zaim_payment",
        input: JSON.stringify({ amount: 680, place: "カフェ", category: "食費", date: "2026-08-23" }),
        output: "Zaim API error: 401 Unauthorized",
        failed: true,
      },
    ],
  },
  {
    // 割り込み（#48）が画面でどう見えるかを確かめるための1本。文字列の代わりに
    // オブジェクトを渡した発言は、途中で遮られた返答として投入する。
    title: "週末の予定を詰める",
    startedAt: daysAgo(1),
    messages: [
      "土曜の午前が空いてる。歯医者の予約を入れたいんだけど、他に何かあったっけ。",
      { content: "土曜の午前でしたら、先に押さえておきたいのは", interrupted: true },
      "ごめん、日曜の話だった。日曜の午前で。",
      "日曜の午前は何も入っていません。歯医者は前日までの予約が要るところが多いので、今日中に電話しておくと確実です。",
    ],
  },
  {
    title: "自転車の買い替え候補",
    startedAt: daysAgo(30),
    messages: [
      "通勤用の自転車を買い替えたい。片道5kmくらい。",
      "片道5kmなら**クロスバイク**が扱いやすい距離です。予算と、駐輪場所が屋内か屋外かを教えてください。屋外なら防犯と防錆の条件が先に効きます。",
    ],
  },
];

// ダミーの接続（#46）。空のままだと接続画面の「繋いでいるもの」側を確かめられない。
//
// **どちらも相談には渡らない状態にしてある。** 使えるトークンを持った接続を入れると、
// 開発環境で相談を送るたびに実在しない資格情報で外部サービスへ繋ぎに行き、返答の生成
// そのものが失敗する。休止中（enabled=false）と未接続（accessToken=null）の2つを置いて、
// 状態の出し分けだけを確かめられるようにしている。
const CONNECTION_SEEDS = [
  {
    label: "AIDE",
    slug: "aide",
    url: "https://aide.gucchii.com/mcp",
    enabled: false,
    accessToken: "dev-dummy-access-token",
  },
  {
    label: "Notion",
    slug: "notion",
    url: "https://mcp.notion.com/mcp",
    enabled: true,
    accessToken: null,
  },
];

// 通知の購読（#79）。設定の画面が「登録済みの端末」を件数で出すため、空だと
// その表示を確かめられない。
//
// **endpointは絶対に解決しないホストにしてある**（`.invalid` は予約済みTLD）。
// 実在するPushサービスのURLを入れると、開発環境で「試しに送る」を押すたびに
// 外部へリクエストが飛ぶ。
//
// **鍵は「長さの正しい」使い捨ての値にしてある。** web-pushは送信の前に長さを検証し
// （p256dhは65バイト、authは16バイト）、短いと名前解決より手前で
// `The subscription p256dh value should be 65 bytes long.` で落ちる。適当な文字列にすると、
// 開発環境で「試しに送る」を押したときの失敗の理由が本番と変わってしまう。
const PUSH_SUBSCRIPTION_SEEDS = [
  { endpoint: "https://push.invalid/dev-dummy-iphone", deviceLabel: "iPhone / Safari" },
  { endpoint: "https://push.invalid/dev-dummy-desktop", deviceLabel: "Linux / Chrome" },
];
const DUMMY_P256DH =
  "BBqwI5nKDsS6vttGU-N-qzS2IkGqA2l98SgR6YGlPINPwxqJ7zBmTv82tQz2X50h6LoERX2uoPgKf9bv9nfKcsg";
const DUMMY_AUTH = "iAo59Zn5euzmta2BpuwsSA";

// 朝の見通し（#79）。通知を押したときに開く相談がどう見えるかを確かめるための1本。
// **1通目はUSER**（実際にモデルへ渡している依頼そのもの）。秘書の返答を1通目にすると、
// 続きを話しかけたときに /api/chat が先頭を落として渡すため、見通しがモデルから見えなくなる。
const BRIEFING_REQUEST =
  "（自動）おはよう。今日の予定・移動・天気と、部屋やシステムに気になることがないかを確かめて、今日の見通しを短くまとめて。";
const BRIEFING_ANSWER =
  "今日は10時から歯科の予約が入っています。日中は27度まで上がり、夕方から雨の予報なので折りたたみ傘があると安心です。部屋のCO2が1200ppmまで上がっているので、出かける前に換気をおすすめします。";

// お知らせの受け皿（#93）。「話す」画面の吹き出しは、ここに未読が1件も無ければ黙る——
// 空のままだと、実装が効いているのか材料が無いだけなのかを画面から切り分けられない。
//
// **1件だけ「すでに出したもの」を入れてある。** 開いた直後の吹き出しに何か出ている状態と、
// 一度出したものが二度と選ばれないことの両方を確かめるため。
//
// 期限（expiresAt）は投入時刻からの相対で入れる。固定の日時にすると、シードを流した翌日に
// すべて期限切れになり、候補が0件のまま「黙っているのが正しいのか」が分からなくなる。
const NOTICE_SEEDS = [
  {
    source: "aide",
    kind: "schedule",
    dedupeKey: "dev-dental",
    title: "歯科の予約",
    body: "13時から歯科の予約があります。自宅からは電車で25分かかります。",
    priority: "URGENT",
    // 押したときに開く先（#137）。**別のオリジンなので新しいタブで開く**——同じタブで移る
    // アプリ内のパス（下の `dev-briefing`）と見え方が違うので、両方を入れてある。
    url: "https://aide.gucchii.com/schedule",
    expiresInMinutes: 180,
  },
  {
    source: "aide",
    kind: "room",
    dedupeKey: "dev-co2",
    title: "部屋の換気",
    body: "部屋のCO2が1200ppmまで上がっています。換気をおすすめします。",
    priority: "NORMAL",
    // **リンクを持たない行をわざと残してある**（#137）。ここが今までどおりの見た目で、
    // 「開く」が出ないことを確かめられないと、リンクの有無で出し分けているのか
    // すべてに出ているのかを画面から切り分けられない。
    expiresInMinutes: 120,
  },
  {
    source: "dayspan",
    kind: "habit",
    dedupeKey: "dev-journal",
    title: "今日の記録",
    body: "今日の記録がまだ書かれていません。",
    priority: "LOW",
    url: "https://dayspan.gucchii.com/",
    expiresInMinutes: 600,
  },
  {
    source: "asset-manager",
    kind: "report",
    dedupeKey: "dev-monthly",
    body: "先月の資産レポートが出来上がっています。",
    priority: "LOW",
    // いま出している1件（#137の「いま出しています」の開くボタンと、吹き出しの「開く」）。
    url: "https://asset-manager.gucchii.com/reports",
    // すでに秘書が選んで出したもの。もう候補には戻らない。
    spokenText: "先月の資産レポートが出来上がっていますよ。",
    spokenUrgent: false,
    shownMinutesAgo: 12,
    expiresInMinutes: 1440,
  },
  // まだ出せないもの（#114の一覧で「21:00から出せます」の欄を確かめるため）。
  // `showAt` が先なので候補には入らず、吹き出しには出ない。
  {
    source: "aide",
    kind: "schedule",
    dedupeKey: "dev-recycle",
    title: "資源ごみ",
    body: "明日は資源ごみの日です。玄関に出しておくと安心です。",
    priority: "NORMAL",
    showAtInMinutes: 180,
    expiresInMinutes: 900,
  },
  // アプリの中のページを指すお知らせ（#137）。朝の見通し（#79）が自分で積むのと同じ形で、
  // **同じタブのまま移る**（外部のリンクは新しいタブ）。`fromMorningBriefing` を書いておくと、
  // 下の投入で朝の見通しの相談IDを引いて `/c/<ID>` に組み立てる（IDは流すたび変わるため）。
  {
    source: "aide-bot",
    kind: "morning-briefing",
    dedupeKey: "dev-briefing",
    title: "今日の見通し",
    body: "今日の見通しをお伝えしています。",
    priority: "NORMAL",
    fromMorningBriefing: true,
    expiresInMinutes: 480,
  },
  // 出さないまま期限が切れたもの（#114）。**読まれずに消えた**ことが分かる唯一の欄で、
  // ここが空だと実装が効いているのか材料が無いだけなのかを画面から切り分けられない。
  {
    source: "aide",
    kind: "delivery",
    dedupeKey: "dev-redelivery",
    title: "宅配の再配達",
    body: "18時〜20時の再配達を受け付けています。",
    priority: "NORMAL",
    expiresInMinutes: -180,
  },
];

async function main() {
  const user = await db.user.upsert({
    where: { supabaseUserId: CI_BYPASS_SUPABASE_USER_ID },
    update: {},
    create: {
      supabaseUserId: CI_BYPASS_SUPABASE_USER_ID,
      email: "ci-screenshot-bot@example.com",
      name: "開発用ダミーユーザー",
    },
  });

  console.log(`[aide-bot] バイパス用ユーザーをupsertしました: id=${user.id} name=${user.name}`);

  // 相談スレッドと発言（#24）。認証を抜けても画面が空のままでは、一覧・Markdown表示・
  // スレッド切り替えのどれも確かめられない。
  //
  // 繰り返し流しても増えないよう、タイトルで引いてから作る。Conversationのタイトルには
  // 一意制約が無いのでupsertは使えない。
  for (const seed of CONVERSATION_SEEDS) {
    const existing = await db.conversation.findFirst({
      where: { userId: user.id, title: seed.title },
      select: { id: true },
    });
    if (existing) continue;

    // createdAt / updatedAt は明示的に入れる。updatedAt は @updatedAt なので、
    // 渡さないと全件が実行時刻になり、一覧の見出しが「今日」だけになる。
    const lastMessageAt = new Date(seed.startedAt.getTime() + (seed.messages.length - 1) * 60_000);

    await db.conversation.create({
      data: {
        userId: user.id,
        title: seed.title,
        createdAt: seed.startedAt,
        updatedAt: lastMessageAt,
        messages: {
          create: seed.messages.map((message, index) => ({
            role: index % 2 === 0 ? "USER" : "ASSISTANT",
            // createdAtが同一だと並び順が不定になるため、1分ずつずらす。
            createdAt: new Date(seed.startedAt.getTime() + index * 60_000),
            content: typeof message === "string" ? message : message.content,
            interrupted: typeof message === "string" ? false : message.interrupted === true,
          })),
        },
        // 書き込みの道具の記録（#81）。発言とは別のテーブルに持ち、画面が時刻順に混ぜて出す。
        toolCalls: {
          create: (seed.toolCalls ?? []).map((call) => ({
            user: { connect: { id: user.id } },
            serverLabel: call.serverLabel,
            serverSlug: call.serverSlug,
            toolName: call.toolName,
            input: call.input,
            output: call.output,
            failed: call.failed,
            // 直後の返答より前に並ぶよう、その発言の1秒前にする。
            createdAt: new Date(
              seed.startedAt.getTime() + (call.afterMessageIndex + 1) * 60_000 - 1_000,
            ),
          })),
        },
        // 消費量は返答とは別の行に持つ（#51）。返答1件につきAPIを1回呼んだ形にする。
        apiUsages: {
          create: seed.messages
            .map((message, index) => ({ message, index }))
            .filter(({ index }) => index % 2 === 1)
            .map(({ index }) =>
              dummyUsage(
                (index - 1) / 2,
                new Date(seed.startedAt.getTime() + index * 60_000),
                user.id,
              ),
            ),
        },
      },
    });
  }

  // 使用量の画面（#51）は日別のグラフを持つ。相談が数日ぶんしか無いとグラフがほぼ空になり、
  // 「日ごとに並んで見えるか」を確かめられないため、直近14日ぶんの往復を1本のスレッドへ入れる。
  const USAGE_HISTORY_TITLE = "毎日のこまごました相談";
  // 日ごとの往復数（古い日→今日）。棒の高さが散るように、あえて凸凹させてある。
  const USAGE_DAILY_TURNS = [1, 2, 3, 1, 4, 1, 2, 3, 1, 5, 1, 3, 2, 2];

  const usageHistoryExists = await db.conversation.findFirst({
    where: { userId: user.id, title: USAGE_HISTORY_TITLE },
    select: { id: true },
  });

  if (!usageHistoryExists) {
    const messages = [];
    const usages = [];

    USAGE_DAILY_TURNS.forEach((turns, dayIndex) => {
      // 配列の先頭がいちばん古い日。最後の要素が今日。
      const daysBefore = USAGE_DAILY_TURNS.length - 1 - dayIndex;

      for (let turn = 0; turn < turns; turn += 1) {
        // 同じ日の中でも時刻をずらす。9時台から1往復ごとに1時間ずつ後ろへ。
        const askedAt = new Date(daysAgo(daysBefore).getTime());
        askedAt.setHours(9 + turn, 0, 0, 0);

        messages.push({
          role: "USER",
          createdAt: askedAt,
          content: `${daysBefore}日前の${turn + 1}件目の相談です。`,
          interrupted: false,
        });
        messages.push({
          role: "ASSISTANT",
          createdAt: new Date(askedAt.getTime() + 60_000),
          content: "承知しました。要点だけお伝えします。",
          interrupted: false,
        });
        // 日ごとにモデルを回して、単価の違う記録が混ざった状態を作る（#71）。
        usages.push(
          dummyUsage(
            turn,
            new Date(askedAt.getTime() + 60_000),
            user.id,
            USAGE_MODELS[dayIndex % USAGE_MODELS.length],
          ),
        );
      }
    });

    await db.conversation.create({
      data: {
        userId: user.id,
        title: USAGE_HISTORY_TITLE,
        createdAt: messages[0].createdAt,
        updatedAt: messages[messages.length - 1].createdAt,
        messages: { create: messages },
        apiUsages: { create: usages },
      },
    });
  }

  // 相談に紐づかない記録（#133）。**この2つが無いと、使用量の画面の従量課金の節が
  // 「今日ぶん1件」だけになり、日別のグラフも表も空に近い状態でしか確かめられない。**
  //
  // - 朝の見通し（#79）: `conversationId` は付かない（相談は生成が終わってから作るため）。
  //   1日1回で、`pause_turn` で頼み直した日だけ2行になる
  // - お知らせの選定（#132）: Codexで動くぶん。相談以外にも定額の記録が積まれることを
  //   画面で確かめられるように入れてある
  const standaloneUsageExists = await db.apiUsage.count({
    where: { userId: user.id, conversationId: null },
  });

  if (standaloneUsageExists === 0) {
    const standalone = [];

    // 古い日→今日。8日前だけ pause_turn で2回叩いた形にする。
    for (let daysBefore = 13; daysBefore >= 0; daysBefore -= 1) {
      const at = daysAgo(daysBefore);
      at.setHours(7, 0, 30, 0);

      const calls = daysBefore === 8 ? 2 : 1;
      for (let call = 0; call < calls; call += 1) {
        standalone.push({
          userId: user.id,
          model: BRIEFING_USAGE_MODEL,
          inputTokens: 8600 + call * 400 + daysBefore * 40,
          outputTokens: 560 + call * 40,
          cacheWriteTokens: 0,
          // 1日1回ではキャッシュの保持時間（5分）をとうに過ぎており、実際にも効かない（#56）。
          cacheReadTokens: 0,
          createdAt: new Date(at.getTime() + call * 40_000),
        });
      }

      // お知らせの選定は「話す」画面を開いている間だけ走る。毎日は積まない。
      if (daysBefore % 3 === 0) {
        const noticeAt = new Date(at.getTime());
        noticeAt.setHours(21, 10, 0, 0);
        standalone.push({
          userId: user.id,
          model: "gpt-5.6-luna",
          inputTokens: 3200,
          outputTokens: 40,
          cacheWriteTokens: 0,
          cacheReadTokens: 8960,
          createdAt: noticeAt,
        });
      }
    }

    await db.apiUsage.createMany({ data: standalone });
    console.log(`[aide-bot] 相談に紐づかない使用量を投入しました: ${standalone.length}件`);
  }

  const conversationCount = await db.conversation.count({ where: { userId: user.id } });
  const toolCallCount = await db.toolCall.count({ where: { userId: user.id } });
  console.log(
    `[aide-bot] 相談スレッドを投入しました: ${conversationCount}件（書き込みの記録 ${toolCallCount}件）`,
  );

  // 外部サービスとの接続（#46）。slugは利用者の中で一意なのでupsertできる。
  for (const seed of CONNECTION_SEEDS) {
    await db.mcpConnection.upsert({
      where: { userId_slug: { userId: user.id, slug: seed.slug } },
      update: {},
      create: { ...seed, userId: user.id },
    });
  }

  const connectionCount = await db.mcpConnection.count({ where: { userId: user.id } });
  console.log(`[aide-bot] 外部サービスとの接続を投入しました: ${connectionCount}件`);

  // 通知の購読（#79）。一意制約は endpointHash（endpointのSHA-256）に張ってある。
  // MariaDBは長いTEXTへそのまま一意制約を張れないため（src/lib/push/subscriptions.ts）。
  for (const seed of PUSH_SUBSCRIPTION_SEEDS) {
    const endpointHash = createHash("sha256").update(seed.endpoint).digest("hex");
    const data = {
      userId: user.id,
      endpoint: seed.endpoint,
      endpointHash,
      p256dh: DUMMY_P256DH,
      auth: DUMMY_AUTH,
      deviceLabel: seed.deviceLabel,
    };

    await db.pushSubscription.upsert({ where: { endpointHash }, update: {}, create: data });
  }

  const subscriptionCount = await db.pushSubscription.count({ where: { userId: user.id } });
  console.log(`[aide-bot] 通知の購読を投入しました: ${subscriptionCount}件`);

  // 朝の見通し（#79）。抑制の記録（NotificationLog）も対で入れる。**日付の鍵は日本時間**で
  // 作る（src/lib/briefing.ts の jstDateKey と同じ）。ずれると、シード投入した日に
  // 実際の朝の見通しがもう1本届いてしまう。
  const dedupeKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const briefingExists = await db.notificationLog.findUnique({
    where: { userId_kind_dedupeKey: { userId: user.id, kind: "morning-briefing", dedupeKey } },
    select: { id: true },
  });

  if (!briefingExists) {
    const briefedAt = new Date(now.getTime());
    briefedAt.setHours(7, 0, 0, 0);

    const conversation = await db.conversation.create({
      data: {
        userId: user.id,
        title: `${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(now)}の見通し`,
        createdAt: briefedAt,
        updatedAt: briefedAt,
        messages: {
          create: [
            {
              role: "USER",
              content: BRIEFING_REQUEST,
              createdAt: briefedAt,
              interrupted: false,
            },
            {
              role: "ASSISTANT",
              content: BRIEFING_ANSWER,
              createdAt: new Date(briefedAt.getTime() + 1000),
              interrupted: false,
            },
          ],
        },
        // 見通しの生成もMessages APIの呼び出し1回ぶんとして数える（#51）。
        apiUsages: {
          create: [
            {
              user: { connect: { id: user.id } },
              model: BRIEFING_USAGE_MODEL,
              inputTokens: 4200,
              outputTokens: 210,
              cacheWriteTokens: 0,
              cacheReadTokens: 0,
              createdAt: new Date(briefedAt.getTime() + 1000),
            },
          ],
        },
      },
      select: { id: true },
    });

    await db.notificationLog.create({
      data: {
        userId: user.id,
        kind: "morning-briefing",
        dedupeKey,
        title: "今日の見通し",
        body: BRIEFING_ANSWER,
        conversationId: conversation.id,
        deliveredCount: PUSH_SUBSCRIPTION_SEEDS.length,
        createdAt: new Date(briefedAt.getTime() + 2000),
      },
    });

    console.log("[aide-bot] 朝の見通しを1件投入しました");
  }

  // お知らせの受け皿（#93）。dedupeKeyで畳まれるので、何度流しても増えない。
  for (const seed of NOTICE_SEEDS) {
    const { expiresInMinutes, shownMinutesAgo, showAtInMinutes, fromMorningBriefing, ...rest } = seed;

    // アプリの中の相談を指すぶん（#137）。相談のIDは流すたびに変わるので、朝の見通しの
    // 記録（NotificationLog）から引き直す。**相談のタイトルで引かない**——タイトルは
    // 「9月2日の見通し」のように日付で変わる。見つからなければリンク無しで積む。
    let url = rest.url ?? null;
    if (fromMorningBriefing) {
      const log = await db.notificationLog.findFirst({
        where: { userId: user.id, kind: "morning-briefing", conversationId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { conversationId: true },
      });
      url = log?.conversationId ? `/c/${log.conversationId}` : null;
    }

    const data = {
      ...rest,
      url,
      // `title` は後から足した列で、Prismaのスキーマでは必須（DB側の既定 '' はPrismaを
      // 通らない）。積む側は省略できるので、`ingestNotice()` と同じく本文の1行目で埋める。
      title: seed.title ?? seed.body.split("\n", 1)[0].slice(0, 120),
      // 負の値を渡すと「すでに期限が切れたもの」になる（#114の一覧で確かめる）。
      expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
      showAt: showAtInMinutes ? new Date(now.getTime() + showAtInMinutes * 60 * 1000) : null,
      shownAt: shownMinutesAgo ? new Date(now.getTime() - shownMinutesAgo * 60 * 1000) : null,
    };

    await db.notice.upsert({
      where: {
        userId_source_kind_dedupeKey: {
          userId: user.id,
          source: seed.source,
          kind: seed.kind,
          dedupeKey: seed.dedupeKey,
        },
      },
      update: data,
      create: { userId: user.id, ...data },
    });
  }

  console.log(`[aide-bot] お知らせを${NOTICE_SEEDS.length}件投入しました`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
