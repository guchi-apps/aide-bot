import {
  BRIEFING_SKIP_TOKEN,
  MORNING_BRIEFING_REQUEST,
  briefingSystemPrompt,
} from "@/lib/anthropic";
import { BRIEFING_MODEL } from "@/lib/chat-model";
import { runCodexExec } from "@/lib/codex";
import { jstDayKey } from "@/lib/day-key";
import { primaryConversation } from "@/lib/day-log";
import { db } from "@/lib/db";
import { listConnectedServers, toCodexMcpServers } from "@/lib/mcp/connections";
import { ingestNotice } from "@/lib/notices";
import { countSubscriptions, sendPushToUser, usersWithSubscriptions } from "@/lib/push/subscriptions";
import { recordApiUsage } from "@/lib/usage";

/**
 * 秘書の方から知らせる「朝の見通し」（#79）。**サーバー専用。**
 *
 * cronから `POST /api/briefing` を叩いて動かす。常駐プロセスも新しい依存も足さない形で、
 * AIDEの `src/worker/run.ts`（常駐させずワンショットで実行し、スケジューリングは外に任せる）
 * と同じ考え方。
 *
 * **#183で生成元をCodex CLI（ChatGPTのサブスク枠）へ移した。** #128（相談）・#132（お知らせ
 * 選定）・#167（自宅の前提）に続く最後の1本で、**これでアプリからAnthropic（従量課金）を
 * 呼ぶ経路は無くなった**——`ANTHROPIC_API_KEY` も `@anthropic-ai/sdk` も要らない。
 * 移せるようになったのは#131でCodexからリモートMCPへ繋げるようになり、`disabled_tools` で
 * 書き込みの道具を名指しで止められると分かったため（#151で「移せない」とした理由が消えた）。
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
 * `codex exec` を待つ上限（#183）。
 *
 * 材料は6本（予定・天気、部屋、システム、支払予定、放置セッション、確認待ち）あり、
 * **まとめて一度に呼ばせる**（`briefingServiceRules()` の指示と、Codexへ渡す接続の
 * `supports_parallel_tool_calls=true`）。それでも順に呼ばれた回はそのぶん往復が増える
 * （道具1回あたり約9秒。#131の実測）ので、歯止めとしてここで打ち切る。
 *
 * 自宅の取り込み（120秒。`home-profile.ts`）より長いのは、**誰も画面の前で待っていない**
 * ため。打ち切られた日は記録を残さないので、次のcronの起動でやり直せる。
 */
const CODEX_TIMEOUT_MS = 180 * 1000;

/**
 * 朝の見通しを、秘書の吹き出しの候補として残しておく時間（#93）。
 *
 * 朝7時に作って6時間なので、昼過ぎまで。**その日のうちでも、夕方に「今日の見通し」が
 * 吹き出しへ出てくると、いま知らせている内容だと誤解される。**
 */
const BRIEFING_NOTICE_LIFETIME_MS = 6 * 60 * 60 * 1000;

/**
 * 日本時間での「その日の何分目か」（0〜1439）。#121で時刻を設定できるようにするために追加。
 *
 * サーバーのタイムゾーンに頼らない（`jstDayKey()` と同じ理由）。
 */
function jstMinuteOfDay(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  // `hour` は24時制で深夜に "24" を返すことがある環境差があるため丸めておく（`jstParts()` と同じ）。
  return (value("hour") % 24) * 60 + value("minute");
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
 * Codexへ渡す1本のプロンプト（#183）。
 *
 * **Codexにはシステムプロンプトを別に渡す口が無い。** お知らせ選定（`buildNoticePrompt()`）と
 * 同じく、体裁・材料の指示（`briefingSystemPrompt()`）と依頼の文面を `---` で繋いで1本にする。
 *
 * **依頼の文面はそのまま相談の1通目として保存される**ので、ここで足し引きしないこと（#79）。
 */
function buildBriefingPrompt(labels: string[]): string {
  return [briefingSystemPrompt(labels), "---", MORNING_BRIEFING_REQUEST].join("\n\n");
}

/**
 * 見通しの本文をモデルに書かせる。
 *
 * **材料はすべて外部サービス（AIDE）から取る。** 繋いでいる接続が1つも無ければ道具が
 * 渡らず、書けるものが何も無いので呼び出す前に諦める（費用だけ掛かって中身が空になる）。
 *
 * 形は自宅の取り込み（`src/lib/home-profile.ts` の `refreshHomeProfile()`）に揃えてある。
 * **失敗は投げる**——呼び出し元（`runFor()`）が捕まえて、その日の記録を残さずに戻る。
 */
async function generateBriefing(userId: string): Promise<string> {
  const servers = await listConnectedServers(userId);
  if (servers.length === 0) {
    throw new Error("外部サービスへ繋いでいないため、今日の材料を取れませんでした。");
  }

  // **書き込みの道具は設定によらず常に止める**（#78・#79）。相談側は設定で渡せるが、
  // ここは利用者のいないところで動いており、登録の前に復唱して確かめる相手がいない。
  const { mcpServers } = toCodexMcpServers(servers, false);

  const result = await runCodexExec({
    model: BRIEFING_MODEL,
    prompt: buildBriefingPrompt(servers.map((server) => server.label)),
    signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
    mcpServers,
  });

  // 相談はまだ作っていないので conversationId は付けない（#51は「1呼び出し＝1行」で、
  // 相談への紐付けは任意）。**打ち切られた回は `usage` がnullで行が作られない**——
  // `turn.completed` が届いておらず、そこまでの消費量が分からないため（#133）。
  if (result.usage) {
    await recordApiUsage({ userId, conversationId: null, model: BRIEFING_MODEL, usage: result.usage });
  }

  // 打ち切りは上限に掛かったときにしか起きない（この経路に利用者からの割り込みは無い）。
  if (result.interrupted) {
    throw new Error(`朝の見通しの生成が${CODEX_TIMEOUT_MS / 1000}秒で返らなかった`);
  }
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }

  // **`text` ではなく `reply` を読む**（#131）。道具を呼んだ回は「確認します」のような前置きが
  // 別の `agent_message` として先に届くので、`text`（全部の連結）を通知の本文にすると
  // 前置きごとロック画面へ出る。
  return result.reply.trim();
}

type BriefingUser = { id: string; briefingHour: number; briefingMinute: number };

/**
 * 起きた合図（#233）を受け付ける下限。日本時間の4:00。
 *
 * 睡眠の判定はdayspanに任せている（ショートカットがdayspanの応答を見て分岐する）が、それを
 * 組み忘れた・夜ふかし中にリマインダーを止めた、という合図で送ると、`NotificationLog` の抑制で
 * **その日の分を夜中に使い切る。** 取り返しが付かない側なので、サーバーでも弾いておく。
 */
const WAKE_EARLIEST_MINUTE = 4 * 60;

/**
 * いま朝の見通しを作っている利用者（#233）。
 *
 * 起きた合図（`/api/briefing/wake`）とcronが重なると、同じ日に2回生成しうる。今日ぶんの記録
 * （`NotificationLog`）は**送り終えてから**書くので、生成に掛かる最大180秒のあいだは抑制が
 * 効かない。プロセス内のSetで足りるのは、PM2で1プロセスしか動かさないため（`compact.ts` の
 * `running` と同じ前提）。
 */
const inFlight = new Set<string>();

/** その日の朝の見通しをすでに扱ったか（送った・黙った、のどちらも含む）。 */
async function handledOn(userId: string, dedupeKey: string): Promise<boolean> {
  const log = await db.notificationLog.findUnique({
    where: { userId_kind_dedupeKey: { userId, kind: MORNING_BRIEFING_KIND, dedupeKey } },
    select: { id: true },
  });
  return log !== null;
}

/**
 * 1人ぶんの朝の見通しを作って届ける。
 *
 * 抑制は**生成の前**に見る。まず設定時刻を過ぎているか（軽い・DBを引かない判定）を見て、
 * 次にすでに今日ぶんの記録があるか（#121で追加する前からの判定）を見る。どちらも
 * APIを1回も叩かずに戻れるため、cronが同じ日に何度叩かれても費用は掛からない。
 *
 * **起きた合図から走らせるとき（#233）は設定時刻を見ない。** 設定時刻は、合図を送っている日には
 * 「遅くともこの時刻」の意味になる。
 */
async function runFor(
  { id: userId, briefingHour, briefingMinute }: BriefingUser,
  now: Date,
  options: { ignoreScheduledTime?: boolean } = {},
): Promise<BriefingOutcome> {
  if (!options.ignoreScheduledTime && jstMinuteOfDay(now) < briefingHour * 60 + briefingMinute) {
    return { userId, status: "skipped", delivered: 0, detail: "設定時刻前" };
  }

  if (inFlight.has(userId)) {
    return { userId, status: "skipped", delivered: 0, detail: "生成中" };
  }

  inFlight.add(userId);
  try {
    return await deliverFor(userId, now);
  } finally {
    inFlight.delete(userId);
  }
}

async function deliverFor(userId: string, now: Date): Promise<BriefingOutcome> {
  // 抑制の鍵は日本時間の日付。VPSはJSTだが、CIやマイグレーションの実行環境はUTCで動くことが
  // あり、日付の境目だけがずれると**同じ日に2本出る**（#79）。
  const dedupeKey = jstDayKey(now);

  if (await handledOn(userId, dedupeKey)) {
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

  // **#157から、新しい相談は作らず連続セッションへ追記する。** 秘書とのやり取りは1本に
  // 続いているので、朝の見通しだけ別のスレッドになっていると、続きを話しかけたときに
  // きのうまでの流れがモデルから見えない。
  //
  // **1通目は実際にモデルへ渡した依頼そのもの**にしてある。秘書の返答だけを積むと、
  // 履歴を読み返したときに秘書が突然しゃべり出したように見える（#79）。
  const conversation = await primaryConversation(userId);

  // **発言の時刻は、受けた時刻（`now`）ではなく書き込む直前に取り直す**（#261）。`now` は
  // 生成を始める前の値で、Codexの往復（最大180秒）のあいだに利用者が話しかけると、
  // その発言より前へ見通しが割り込み、画面の並びも次の往復でモデルへ渡す履歴も実際の
  // 順序と食い違う。抑制の鍵（`dedupeKey`）と吹き出しの期限は日付・基準時刻の話なので
  // `now` のまま。
  const savedAt = new Date();

  await db.$transaction([
    db.message.createMany({
      data: [
        { conversationId: conversation.id, role: "USER", content: MORNING_BRIEFING_REQUEST, createdAt: savedAt },
        // 同じ時刻だと並び順が不定になる。1秒ずらして返答を後ろに固定する。
        {
          conversationId: conversation.id,
          role: "ASSISTANT",
          content: text,
          createdAt: new Date(savedAt.getTime() + 1000),
        },
      ],
    }),
    // 最後に話した時刻（#101のひとりごとが読む）。発言を足しただけでは動かない。
    db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: savedAt } }),
  ]);

  const delivered = await sendPushToUser(userId, {
    title: BRIEFING_TITLE,
    // 押した先は今日の記録。**追記した先がそこ**なので、開けば見通しがいちばん下にある
    // （#157で `/c/<ID>` を指さなくなった。古い通知の受け皿は残してある）。
    body: text,
    url: "/",
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
      url: "/",
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
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, briefingHour: true, briefingMinute: true },
  });

  const outcomes: BriefingOutcome[] = [];

  for (const user of users) {
    try {
      outcomes.push(await runFor(user, now));
    } catch (error) {
      console.error(`[aide-bot] 朝の見通しの処理に失敗した: ${user.id}`, error);
      outcomes.push({
        userId: user.id,
        status: "failed",
        delivered: 0,
        detail: error instanceof Error ? error.message : "不明なエラー",
      });
    }
  }

  return outcomes;
}

export type WakeSignalCheck =
  | { accepted: true; message: string }
  | { accepted: false; status: "too_early" | "running" | "already_sent" | "no_device"; message: string };

/**
 * 起きた合図（#233）で朝の見通しを作ってよいかを、**生成を仕掛ける前に**確かめる。
 *
 * どれかに当たれば生成せず、理由をショートカットの通知に出る文で返す。とくに購読の確認は、
 * cronの経路（`runMorningBriefing()` が `usersWithSubscriptions()` で絞る）には元からあるが
 * `runFor()` には無い。見ないまま走らせると、どの端末にも届かないのにCodexの利用枠を使い、
 * `NotificationLog` にその日の分を記録して使い切る。
 */
export async function checkWakeSignal(userId: string, now: Date): Promise<WakeSignalCheck> {
  if (jstMinuteOfDay(now) < WAKE_EARLIEST_MINUTE) {
    return {
      accepted: false,
      status: "too_early",
      message: "4時より前の合図なので、朝のお知らせはまだお届けしません。",
    };
  }

  if (inFlight.has(userId)) {
    return { accepted: false, status: "running", message: "今日の見通しは、いままとめているところです。" };
  }

  const [sent, devices] = await Promise.all([handledOn(userId, jstDayKey(now)), countSubscriptions(userId)]);

  if (sent) {
    return { accepted: false, status: "already_sent", message: "今日の見通しは、もうお届けしています。" };
  }

  if (devices === 0) {
    return {
      accepted: false,
      status: "no_device",
      message: "通知を受け取る端末が登録されていないため、お届けできません。設定の画面で通知をオンにしてください。",
    };
  }

  return {
    accepted: true,
    message: "おはようございます。今日の見通しをまとめて、通知でお届けしますね。",
  };
}

/**
 * 起きた合図から朝の見通しを作って届ける（#233）。**例外を外へ出さない。**
 *
 * 呼び出し元は応答を返した後の `after()` で、投げても伝える相手がいない。結果はログにだけ残す
 * （本文は残さない。`/api/briefing` の応答と同じ理由）。
 */
export async function runWakeBriefing(user: BriefingUser, now: Date): Promise<void> {
  try {
    const { status, delivered, detail } = await runFor(user, now, { ignoreScheduledTime: true });
    console.info(
      `[aide-bot] 起きた合図からの朝の見通し: ${status}（${delivered}台）${detail ? ` ${detail}` : ""}`,
    );
  } catch (error) {
    console.error(`[aide-bot] 起きた合図からの朝の見通しに失敗した: ${user.id}`, error);
  }
}
