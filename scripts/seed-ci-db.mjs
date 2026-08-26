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

// 使用量の画面（#51）で使うモデル名。単価表（src/lib/chat-model.ts の MODEL_PRICING）に
// ある値にしておかないと、画面の概算費用が「表に無いモデル」の扱いになる。
//
// 返答のモデルは設定の画面から切り替えられる（#71）。**切り替えた前後が混ざった記録**を
// 入れておかないと、モデルごとに単価を引き直せているかを画面で確かめられない。
const USAGE_MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
const USAGE_MODEL = USAGE_MODELS[0];

/**
 * API呼び出し1回ぶんのダミーのトークン数（`ApiUsage` の1行）。
 *
 * 履歴は毎回まるごと送り直すため、同じスレッドでは往復を重ねるほど入力ぶんが増える。
 * 画面で内訳を見たときに不自然にならないよう、その形に寄せてある。
 */
const dummyUsage = (turnIndex, createdAt, userId, model = USAGE_MODEL) => ({
  // Conversation配下のネストで作るためconversationIdは省けるが、userIdは自分で繋ぐ必要がある。
  user: { connect: { id: userId } },
  model,
  inputTokens: 3200 + turnIndex * 2600,
  outputTokens: 540 + turnIndex * 160,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
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

  const conversationCount = await db.conversation.count({ where: { userId: user.id } });
  console.log(`[aide-bot] 相談スレッドを投入しました: ${conversationCount}件`);

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
              model: "claude-haiku-4-5",
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
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
