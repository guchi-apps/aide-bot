import type Anthropic from "@anthropic-ai/sdk";

import {
  BRIEFING_MAX_OUTPUT_TOKENS,
  BRIEFING_SKIP_TOKEN,
  MCP_BETA,
  MCP_TOKEN_ALLOWANCE,
  MORNING_BRIEFING_REQUEST,
  briefingSystemPrompt,
  getAnthropicClient,
} from "@/lib/anthropic";
import { BRIEFING_MODEL } from "@/lib/chat-model";
import { db } from "@/lib/db";
import { listConnectedServers, toMcpRequestParts } from "@/lib/mcp/connections";
import { ingestNotice } from "@/lib/notices";
import { sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";

/**
 * 秘書の方から知らせる「朝の見通し」（#79）。**サーバー専用。**
 *
 * cronから `POST /api/briefing` を叩いて動かす。常駐プロセスも新しい依存も足さない形で、
 * AIDEの `src/worker/run.ts`（常駐させずワンショットで実行し、スケジューリングは外に任せる）
 * と同じ考え方。
 *
 * ## 読まれなくなる通知を作らないための決めごと
 *
 * AIDEの `src/worker/notify.ts` が「成功を毎回送ると肝心の失敗が埋もれる」という失敗を
 * 既にしている。同じ轍を踏まないよう、最初から次を入れてある。
 *
 * - **決まった時刻に送るのは1日1本まで。** 一意制約（`NotificationLog`）で守る
 * - **知らせることが無ければ黙る。** モデルが `BRIEFING_SKIP_TOKEN` を返した回は送らない
 * - **通知の失敗で他を巻き込まない。** 送信も記録も例外を外へ出さない
 */

/** 通知の種類。`NotificationLog.kind` に入る。 */
export const MORNING_BRIEFING_KIND = "morning-briefing";

/** 通知の見出し。端末側で同じ理由の通知を上書きするための `tag` も兼ねる。 */
const BRIEFING_TITLE = "今日の見通し";

/**
 * ツール呼び出しで一度返ってきた（`pause_turn`）ときに続きを頼む上限（#46と同じ考え方）。
 *
 * 朝の見通しは複数の道具を順に叩くので、相談よりも `pause_turn` に当たりやすい。
 */
const MAX_TURNS = 4;

/**
 * 朝の見通しを、秘書の吹き出しの候補として残しておく時間（#93）。
 *
 * 朝7時に作って6時間なので、昼過ぎまで。**その日のうちでも、夕方に「今日の見通し」が
 * 吹き出しへ出てくると、いま知らせている内容だと誤解される。**
 */
const BRIEFING_NOTICE_LIFETIME_MS = 6 * 60 * 60 * 1000;

/**
 * 日本時間での日付（`2026-08-26`）。抑制の鍵に使う。
 *
 * サーバーのタイムゾーンに頼らない。VPSはJSTだが、`prisma migrate` の実行環境やCIは
 * UTCで動くことがあり、日付の境目だけがずれると**同じ日に2本出る**。
 */
export function jstDateKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 相談のタイトル。「8月26日の見通し」の形。 */
function briefingConversationTitle(now: Date): string {
  const formatted = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
  }).format(now);

  return `${formatted}の見通し`;
}

/** 1人ぶんの結果。呼び出し元（Route Handler）がそのまま応答に載せる。 */
export type BriefingOutcome = {
  userId: string;
  status: "sent" | "silent" | "skipped" | "failed";
  /** 届けられた端末の数。 */
  delivered: number;
  /** 画面には出ない補足。cronのログで追えるようにする。 */
  detail?: string;
};

/**
 * 1回のAPI呼び出しで使ったトークン数（#51）。
 *
 * **数える単位は「API呼び出し1回」**で、相談と同じ。`pause_turn` で頼み直した回は
 * その回数ぶん行ができる。
 */
async function recordUsage(userId: string, conversationId: string | null, message: Anthropic.Beta.BetaMessage) {
  try {
    await db.apiUsage.create({
      data: {
        userId,
        conversationId,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    // 記録できなくても通知は届けたい（#51と同じ方針）。
    console.error("[aide-bot] 朝の見通しの使用量の記録に失敗した", error);
  }
}

function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/**
 * 見通しの本文をモデルに書かせる。
 *
 * **材料はすべて外部サービス（AIDE）から取る。** 繋いでいる接続が1つも無ければ道具が
 * 渡らず、書けるものが何も無いので呼び出す前に諦める（費用だけ掛かって中身が空になる）。
 */
async function generateBriefing(userId: string): Promise<string> {
  const servers = await listConnectedServers(userId);
  if (servers.length === 0) {
    throw new Error("外部サービスへ繋いでいないため、今日の材料を取れませんでした。");
  }

  // **書き込みの道具は設定によらず常に止める**（#78・#79）。相談側は設定で渡せるが、
  // ここは利用者のいないところで動いており、登録の前に復唱して確かめる相手がいない。
  const { mcpServers, tools } = toMcpRequestParts(servers, false);
  const client = getAnthropicClient();

  const turns: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: MORNING_BRIEFING_REQUEST }] },
  ];

  let answer = "";

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const message = await client.beta.messages.create({
      betas: [MCP_BETA],
      mcp_servers: mcpServers,
      tools,
      model: BRIEFING_MODEL,
      // 道具の呼び出しぶんも `max_tokens` から出る（#46）。本文の200文字だけを見て
      // 詰めると、道具を2回叩いた時点で本文へ回るぶんが尽きる。
      max_tokens: BRIEFING_MAX_OUTPUT_TOKENS + MCP_TOKEN_ALLOWANCE,
      system: briefingSystemPrompt(servers.map((server) => server.label)),
      messages: turns,
    });

    // 相談はまだ作っていないので conversationId は付けない（#51は「1呼び出し＝1行」で、
    // 相談への紐付けは任意）。黙った回でも入力ぶんはもう使い終わっている。
    await recordUsage(userId, null, message);

    answer = textOf(message);
    if (message.stop_reason !== "pause_turn") break;

    turns.push({ role: "assistant", content: message.content });
  }

  return answer;
}

/**
 * 1人ぶんの朝の見通しを作って届ける。
 *
 * 抑制は**生成の前**に見る。すでに今日ぶんの記録があれば、APIを1回も叩かずに戻る
 * （cronが二重に登録されていても費用が二重に掛からない）。
 */
async function runFor(userId: string, now: Date): Promise<BriefingOutcome> {
  const dedupeKey = jstDateKey(now);

  const already = await db.notificationLog.findUnique({
    where: { userId_kind_dedupeKey: { userId, kind: MORNING_BRIEFING_KIND, dedupeKey } },
    select: { id: true },
  });

  if (already) {
    return { userId, status: "skipped", delivered: 0, detail: `${dedupeKey} は送信済み` };
  }

  let text: string;
  try {
    text = await generateBriefing(userId);
  } catch (error) {
    // 生成に失敗した日は**記録を残さない**。残すと、直った後の再実行でも抑制が効いて
    // その日は二度と届かなくなる。cronが1日1回なら実質1回で諦めることになる。
    console.error("[aide-bot] 朝の見通しの生成に失敗した", error);
    return {
      userId,
      status: "failed",
      delivered: 0,
      detail: error instanceof Error ? error.message : "不明なエラー",
    };
  }

  // 知らせることが無いと判断した回。記録だけ残して黙る（同じ日に作り直させない）。
  if (text === "" || text === BRIEFING_SKIP_TOKEN) {
    await db.notificationLog.create({
      data: { userId, kind: MORNING_BRIEFING_KIND, dedupeKey, title: BRIEFING_TITLE, body: "" },
    });

    return { userId, status: "silent", delivered: 0 };
  }

  // 通知を押したときに開く相談。**1通目は実際にモデルへ渡した依頼そのもの**にしてある。
  // 秘書の返答を1通目にすると、続きを話しかけたときに履歴の先頭がassistantになり、
  // `/api/chat` が先頭を落として渡す（Messages APIはuserから始まる必要がある）ため、
  // 肝心の見通しがモデルから見えなくなる。
  const conversation = await db.conversation.create({
    data: {
      userId,
      title: briefingConversationTitle(now),
      messages: {
        create: [
          { role: "USER", content: MORNING_BRIEFING_REQUEST },
          // 同じ時刻だと並び順が不定になる。1秒ずらして返答を後ろに固定する。
          { role: "ASSISTANT", content: text, createdAt: new Date(now.getTime() + 1000) },
        ],
      },
    },
    select: { id: true },
  });

  const delivered = await sendPushToUser(userId, {
    title: BRIEFING_TITLE,
    body: text,
    url: `/c/${conversation.id}`,
    tag: MORNING_BRIEFING_KIND,
  });

  // 同じ内容を、秘書の吹き出しの受け皿へも積む（#93）。
  //
  // **aide-bot自身が最初の「積む側」になる。** 受け皿と投入口だけでは、繋いだアプリが
  // 積みに来るまで吹き出しは黙ったままになる。ここはすでにAIDEから材料を取れている
  // 唯一の経路なので、通知を送ったのと同じ一言をそのまま回す。
  //
  // **積むのは通知を実際に送った回だけ。** 黙った回（BRIEFING_SKIP_TOKEN）は上で戻って
  // いるのでここへ来ない。通知の抑制（NotificationLog）が1日1本を守るので、二重には積まれない。
  //
  // 期限を切っておくのは、朝の見通しが夕方の吹き出しに出てこないようにするため
  // （吹き出し側の表示は60分で引っ込むが、候補として選ばれ直すのはこちらで止める）。
  try {
    await ingestNotice(userId, {
      source: "aide-bot",
      kind: MORNING_BRIEFING_KIND,
      dedupeKey,
      body: text,
      url: `/c/${conversation.id}`,
      expiresAt: new Date(now.getTime() + BRIEFING_NOTICE_LIFETIME_MS),
    });
  } catch (error) {
    // 積めなくても通知は届いている。#51・#79と同じで、記録の失敗で本筋を止めない。
    console.error("[aide-bot] 朝の見通しをお知らせの受け皿へ積めなかった", error);
  }

  await db.notificationLog.create({
    data: {
      userId,
      kind: MORNING_BRIEFING_KIND,
      dedupeKey,
      title: BRIEFING_TITLE,
      body: text,
      conversationId: conversation.id,
      deliveredCount: delivered,
    },
  });

  return { userId, status: "sent", delivered };
}

/**
 * 購読している利用者全員へ朝の見通しを届ける。
 *
 * **1人が失敗しても他は続ける。** 利用者は1人という前提だが、片方の失敗で全員ぶんが
 * 止まる形にはしない。
 */
export async function runMorningBriefing(now = new Date()): Promise<BriefingOutcome[]> {
  const userIds = await usersWithSubscriptions();

  const outcomes: BriefingOutcome[] = [];

  for (const userId of userIds) {
    try {
      outcomes.push(await runFor(userId, now));
    } catch (error) {
      console.error(`[aide-bot] 朝の見通しの処理に失敗した: ${userId}`, error);
      outcomes.push({
        userId,
        status: "failed",
        delivered: 0,
        detail: error instanceof Error ? error.message : "不明なエラー",
      });
    }
  }

  return outcomes;
}
