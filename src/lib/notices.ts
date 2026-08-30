import type Anthropic from "@anthropic-ai/sdk";
import { NoticePriority, type Notice } from "@prisma/client";

import {
  NOTICE_MAX_OUTPUT_TOKENS,
  NOTICE_SKIP_TOKEN,
  NOTICE_URGENT_MARK,
  getAnthropicClient,
  noticeSystemPrompt,
} from "@/lib/anthropic";
import { NOTICE_MODEL } from "@/lib/chat-model";
import { db } from "@/lib/db";

/**
 * お知らせの受け皿と、そこから1件を選んで吹き出しへ出す仕組み（#93）。**サーバー専用。**
 *
 * 各アプリが `POST /api/notices` で「利用者に知らせたいこと」を積み、「話す」画面で待って
 * いる間、秘書がここから1件を選んで自分の言葉に直す。#79の朝の見通しと違い、材料を外部
 * サービスから取りに行かない——材料はもう積まれている。
 *
 * ## 読まれなくなる吹き出しを作らないための決めごと
 *
 * 朝の見通し（#79）が「成功を毎回送ると肝心の失敗が埋もれる」を避けたのと同じ問題が、
 * ここにもそのままある。溜まったものを順に垂れ流すと、吹き出しは背景の一部になって
 * 誰も読まなくなる。
 *
 * - **一度に出すのは1件だけ。** 選ぶのはモデルで、選ばれなかったものは次の回まで残る
 * - **いま伝える価値が無ければ黙る。** `NOTICE_SKIP_TOKEN` を返した回は何も出さない
 * - **一度出したものは繰り返さない。** `shownAt` が入った行はもう候補にならない
 * - **未読が0件ならAPIを1回も叩かない。** 黙っている間の費用は0円
 */

/** 選び直す間隔。画面を開いている間、これより短い間隔ではモデルを呼ばない。 */
export const NOTICE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 急ぎが届いたときに、選び直しまで最低限あける間隔。
 *
 * 「急ぎならすぐに」を素直に書くと、急ぎが立て続けに積まれた回に何度も生成が走る。
 * まだ一度も候補に入れていない急ぎがあることを条件にしたうえで、さらにこの間隔で床を張る。
 */
export const NOTICE_URGENT_INTERVAL_MS = 60 * 1000;

/**
 * 出した吹き出しを画面に残しておく時間。
 *
 * これを過ぎたものは「どうぞ、話しかけてください」へ戻す。**残し続けると、朝に選ばれた
 * お知らせが夜まで頭上に居座る**ことになり、いま知らせている内容だと誤解される。
 */
export const NOTICE_DISPLAY_TTL_MS = 60 * 60 * 1000;

/** 1回の生成でモデルへ渡す候補の数。多すぎると選ぶ精度も入力の短さも失う。 */
const MAX_CANDIDATES = 12;

/**
 * 直近の生成の記録。**プロセス内にだけ持つ。**
 *
 * DBへ持たないのは、これが「次にいつ叩いてよいか」を決めるためだけの値で、失っても
 * 1回余分に生成されるだけだから（PM2で1プロセスという既存の前提。#48の
 * `pendingGenerations` と同じ置き方）。
 *
 * `NOTICE_SKIP_TOKEN` で黙った回もここに残す。残さないと、黙った直後の問い合わせが
 * また生成を始めてしまい、**いちばん起こりやすい「知らせることが無い」場面で費用が
 * 10倍になる。**
 */
type LastRun = {
  at: number;
  /** その回に候補として渡したお知らせのID。急ぎの取りこぼしを見分けるために持つ。 */
  consideredIds: Set<string>;
};

const lastRuns = new Map<string, LastRun>();

/** 積む側から受け取る1件ぶん。 */
export type NoticeInput = {
  source: string;
  kind: string;
  dedupeKey: string;
  title?: string;
  body: string;
  url?: string | null;
  priority?: NoticePriority;
  showAt?: Date | null;
  expiresAt?: Date | null;
};

/** 画面へ渡す、いま吹き出しに出ているもの。 */
export type CurrentNotice = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選んだ時刻（ISO）。吹き出しの末尾に「いつ時点か」を出すために使う。 */
  shownAt: string;
};

/**
 * お知らせを積む。同じ `(source, kind, dedupeKey)` は上書きする。
 *
 * 上書きにしてあるのは、積む側が同じ用件を状況の変化に合わせて投げ直せるようにするため
 * （「あと30分」→「あと8分」）。**すでに出したものは書き戻さない**——出し終えた行を
 * 未読へ戻すと、同じ話が何度でも吹き出しに出る。
 */
export async function ingestNotice(userId: string, input: NoticeInput): Promise<Notice> {
  const data = {
    title: input.title ?? input.body.split("\n", 1)[0].slice(0, 120),
    body: input.body,
    url: input.url ?? null,
    priority: input.priority ?? NoticePriority.NORMAL,
    showAt: input.showAt ?? null,
    expiresAt: input.expiresAt ?? null,
  };

  return db.notice.upsert({
    where: {
      userId_source_kind_dedupeKey: {
        userId,
        source: input.source,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
      },
    },
    create: { userId, source: input.source, kind: input.kind, dedupeKey: input.dedupeKey, ...data },
    update: data,
  });
}

/** まだ出していない、いま出せるお知らせ。急ぎ→新しい順。 */
async function pendingNotices(userId: string, now: Date): Promise<Notice[]> {
  return db.notice.findMany({
    where: {
      userId,
      shownAt: null,
      OR: [{ showAt: null }, { showAt: { lte: now } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: MAX_CANDIDATES,
  });
}

/** いま吹き出しに出しておくもの。出してから時間が経ちすぎたものは返さない。 */
async function currentNotice(userId: string, now: Date): Promise<CurrentNotice | null> {
  const shown = await db.notice.findFirst({
    where: {
      userId,
      shownAt: { gt: new Date(now.getTime() - NOTICE_DISPLAY_TTL_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { shownAt: "desc" },
  });

  if (!shown?.shownAt || !shown.spokenText) return null;

  return {
    id: shown.id,
    text: shown.spokenText,
    urgent: shown.spokenUrgent,
    shownAt: shown.shownAt.toISOString(),
  };
}

/**
 * 生成を走らせてよいか。
 *
 * 通常は `NOTICE_INTERVAL_MS` に1回まで。ただし**まだ一度も候補に入れていない急ぎ**が
 * 積まれているときは、`NOTICE_URGENT_INTERVAL_MS` まで詰めて先に出す（「急ぎならすぐに」）。
 */
function shouldGenerate(userId: string, pending: Notice[], now: Date): boolean {
  if (pending.length === 0) return false;

  const last = lastRuns.get(userId);
  if (!last) return true;

  const elapsed = now.getTime() - last.at;
  if (elapsed >= NOTICE_INTERVAL_MS) return true;

  const freshUrgent = pending.some(
    (notice) => notice.priority === NoticePriority.URGENT && !last.consideredIds.has(notice.id),
  );

  return freshUrgent && elapsed >= NOTICE_URGENT_INTERVAL_MS;
}

/** モデルへ渡す候補の一覧。番号で選ばせるので、番号と本文の対応をそのまま書く。 */
function candidateList(pending: Notice[], now: Date): string {
  const lines = pending.map((notice, index) => {
    const parts = [`${index + 1}. ${notice.body}`];
    if (notice.priority === NoticePriority.URGENT) parts.push("（積んだ側の申告: 急ぎ）");
    if (notice.expiresAt) {
      const minutes = Math.round((notice.expiresAt.getTime() - now.getTime()) / 60000);
      parts.push(`（あと約${minutes}分で意味が無くなります）`);
    }
    return parts.join(" ");
  });

  const stamp = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return `いまは${stamp}です。候補は次の${pending.length}件です。\n\n${lines.join("\n")}`;
}

/** モデルの返答。1行目が「番号（と急ぎの印）」、2行目が吹き出しに出す文。 */
type Choice = { index: number; urgent: boolean; text: string };

/**
 * モデルの返答を読む。**知らない形で返ってきたら黙る**（nullを返す）。
 *
 * 無理に読み取ろうとすると、前置きの一文がそのまま吹き出しに出たり、番号として読めない
 * ものを0番と見なして関係の無いお知らせを消費したりする。
 */
function parseChoice(answer: string, candidates: number): Choice | null {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) return null;
  if (lines[0] === NOTICE_SKIP_TOKEN) return null;

  const head = /^(\d+)(?:\s+(\S+))?$/.exec(lines[0]);
  if (!head) return null;

  const index = Number(head[1]) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= candidates) return null;

  const text = lines.slice(1).join(" ");
  if (text === "") return null;

  return { index, urgent: head[2] === NOTICE_URGENT_MARK, text };
}

/**
 * 1回のAPI呼び出しで使ったトークン数（#51）。
 *
 * 相談と同じ「1呼び出し＝1行」。相談に紐づかないので `conversationId` は付かない
 * （朝の見通しと同じ）。
 */
async function recordUsage(userId: string, message: Anthropic.Message) {
  try {
    await db.apiUsage.create({
      data: {
        userId,
        conversationId: null,
        model: message.model,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      },
    });
  } catch (error) {
    // 記録できなくても吹き出しは出したい（#51と同じ方針）。
    console.error("[aide-bot] お知らせの選定の使用量の記録に失敗した", error);
  }
}

/** 候補を渡して1件選ばせる。道具は渡さない（材料はもう候補の中にある）。 */
async function chooseNotice(userId: string, pending: Notice[], now: Date): Promise<Choice | null> {
  const client = getAnthropicClient();

  const message = await client.messages.create({
    model: NOTICE_MODEL,
    max_tokens: NOTICE_MAX_OUTPUT_TOKENS,
    system: noticeSystemPrompt(),
    messages: [{ role: "user", content: [{ type: "text", text: candidateList(pending, now) }] }],
  });

  await recordUsage(userId, message);

  const answer = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  return parseChoice(answer, pending.length);
}

/**
 * いま吹き出しに出すものを返す。「話す」画面から定期的に呼ばれる。
 *
 * 生成が要らない回（間隔の中・未読が0件）はDBを引くだけで戻る。**生成に失敗した回は
 * 何も消費しない**——`lastRuns` にも残さないので、次の問い合わせでやり直せる
 * （#79「生成に失敗した日は記録を残さない」と同じ理由）。
 */
export async function resolveNotice(userId: string, now = new Date()): Promise<CurrentNotice | null> {
  const pending = await pendingNotices(userId, now);

  if (!shouldGenerate(userId, pending, now)) {
    return currentNotice(userId, now);
  }

  let choice: Choice | null;
  try {
    choice = await chooseNotice(userId, pending, now);
  } catch (error) {
    // 吹き出しにエラーを出さない。出しても利用者にできることが無く、状況を知らせる場所が
    // 小言で埋まるだけになる。ログにだけ残し、いま出しているものをそのまま続ける。
    console.error("[aide-bot] お知らせの選定に失敗した", error);
    return currentNotice(userId, now);
  }

  // 黙った回も「叩いた」ものとして残す。残さないと次の問い合わせでまた叩く。
  lastRuns.set(userId, { at: now.getTime(), consideredIds: new Set(pending.map((n) => n.id)) });

  if (!choice) return currentNotice(userId, now);

  const chosen = pending[choice.index];
  const updated = await db.notice.update({
    where: { id: chosen.id },
    data: { spokenText: choice.text, spokenUrgent: choice.urgent, shownAt: now },
  });

  return {
    id: updated.id,
    text: choice.text,
    urgent: choice.urgent,
    shownAt: now.toISOString(),
  };
}
