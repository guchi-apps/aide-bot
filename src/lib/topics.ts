import { createHash } from "node:crypto";

import type { Topic } from "@prisma/client";

import { TOPIC_MODEL } from "@/lib/chat-model";
import { runCodexExec } from "@/lib/codex";
import { db } from "@/lib/db";
import { safeNoticeUrl } from "@/lib/notice-url";
import {
  TOPIC_CATEGORIES,
  isTopicCategoryId,
  parseTopicCategories,
  type TopicCategoryId,
} from "@/lib/topic-categories";
import { recordApiUsage } from "@/lib/usage";

/**
 * 話題（#144）。**サーバー専用。**
 *
 * 秘書が雑談の話題として振れるように、ニュースをウェブ検索で仕入れて `Topic` に溜める。
 * 待機中の吹き出し（#101）にはここから新しい数件を回し、相談（`/api/chat`）にも直近のぶんを
 * 材料として添える。**どちらもモデルは呼ばない**——仕入れたときに一度だけ書かせた文を出す
 * だけなので、#93・#101の「黙っている間の費用は0円」はそのまま守られる。
 *
 * ## 仕入れの起点はアプリを開いたとき。cronは足さない
 *
 * 「利用者が開いていないときに動くのは朝の見通し（#79）だけ」という前提を崩さないため、
 * 仕入れは「話す」画面の問い合わせ（`/api/notices/current`）の応答後にバックグラウンドで走る
 * （`refreshTopicsIfStale()`）。前回から `TOPIC_REFRESH_INTERVAL_MS` あいていなければ何もしない
 * ので、開きっぱなしでも1時間に1回まで。1時間触られなければ問い合わせ自体が止まる
 * （`IDLE_LIMIT_MS`。`use-notice.ts`）ので、放置した画面が夜通し仕入れ続けることも無い。
 *
 * ## 検索は `codex --search exec`（ChatGPTのサブスク枠）
 *
 * 新しいAPIキーも依存パッケージも増えない（Issue #144）。実測（サブPC・`codex-cli 0.152.1`・
 * `gpt-5.6-luna`・2026-09-02）では1回27秒、入力64,086トークン（うち29,952がキャッシュ読み）で
 * 見出し・要約・出典URL付きの記事が返った。**相談の1往復の5倍ほど重い**ので、間隔の歯止めを
 * 緩めるときはサブスクの利用枠（5時間ローリング・週次）の減りを見ること。
 *
 * **お知らせ（`Notice`）には積まない。Pushにもしない。** ニュースは「逃すと困る」ものではなく、
 * 用件と同じ経路に流すと、いちばん埋もれさせたくない用件まで巻き添えで読み飛ばされる（#79）。
 */

/** 仕入れの間隔。前回の仕入れ（成否を問わない）からこれだけあいていなければ走らない。 */
export const TOPIC_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 失敗した回のあとに空ける間隔。
 *
 * 通常の間隔より短くして早めにやり直すが、0にはしない——Codexが落ちている間、3分ごとの
 * 問い合わせのたびに27秒の子プロセスを起こし続けることになる。
 */
const TOPIC_RETRY_INTERVAL_MS = 15 * 60 * 1000;

/** 吹き出し・相談の材料として使う期間。これより古い記事は「最近の話題」ではない。 */
export const TOPIC_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** 吹き出しの輪へ渡す件数。多すぎると輪の半分がニュースになり、用件が薄まる。 */
export const TOPIC_BUBBLE_LIMIT = 3;

/** 相談の材料として添える件数。 */
const TOPIC_CHAT_LIMIT = 8;

/** 種類ごとに仕入れる件数。 */
const TOPICS_PER_CATEGORY = 2;

/**
 * `codex --search exec` を待つ上限。
 *
 * 実測27秒の4倍強。お知らせ選定（60秒。`notices.ts`）より長いのは、検索が2回走ると
 * そのぶん伸びるため。応答後のバックグラウンドで走るので、長くても画面は待たされない。
 */
const CODEX_TIMEOUT_MS = 150 * 1000;

/**
 * 直近の仕入れの記録。**プロセス内にだけ持つ**（#93の `lastRuns` と同じ置き方）。
 *
 * DBの `fetchedAt` だけを見ていると、0件しか取れなかった回・失敗した回で時刻が進まず、
 * 3分ごとの問い合わせのたびに仕入れ直してしまう。ここには成否を問わず「叩いた時刻」を残す。
 * 失っても1回余分に仕入れるだけ（プロセス再起動の直後は、DB側の `fetchedAt` が歯止めになる）。
 */
type Attempt = { at: number; failed: boolean; running: boolean };
const attempts = new Map<string, Attempt>();

/** 吹き出しの輪へ渡す1件。 */
export type TopicBubble = {
  id: string;
  /** 秘書が話題として振る一言。吹き出しに出るのはこれ。 */
  lead: string;
  title: string;
  /** 出典。`safeNoticeUrl()` を通した値だけを載せる（`href` へそのまま入るため）。 */
  url: string | null;
  category: string;
};

/** 「話題」ページに並べる1件。 */
export type TopicRow = {
  id: string;
  category: string;
  title: string;
  summary: string;
  lead: string;
  url: string | null;
  sourceName: string;
  publishedOn: string;
  fetchedAt: Date;
};

export type TopicBoard = {
  /** いま仕入れる設定になっている種類。 */
  categories: TopicCategoryId[];
  /** 最後に仕入れた時刻。まだ一度も無ければnull。 */
  lastFetchedAt: Date | null;
  /** 期間内の話題（新しい順）。 */
  topics: TopicRow[];
  /** 吹き出しへ回している件数の上限。画面の注記に使う。 */
  bubbleLimit: number;
  /** 期間（時間）。画面の注記に使う。 */
  lifetimeHours: number;
};

function urlHashOf(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

/** 日本時間の日付と時刻（プロンプトへ「いま」を伝えるため）。 */
function jstStamp(now: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

function toRow(topic: Topic): TopicRow {
  return {
    id: topic.id,
    category: topic.category,
    title: topic.title,
    summary: topic.summary,
    lead: topic.lead,
    // 保存時にも通しているが、出すときにもう一度通す（`Notice.url` と同じ扱い。#137）。
    url: safeNoticeUrl(topic.url),
    sourceName: topic.sourceName,
    publishedOn: topic.publishedOn,
    fetchedAt: topic.fetchedAt,
  };
}

/** 期間内の話題を新しい順に引く。 */
async function recentTopics(userId: string, now: Date, take: number): Promise<Topic[]> {
  return db.topic.findMany({
    where: { userId, fetchedAt: { gt: new Date(now.getTime() - TOPIC_LIFETIME_MS) } },
    // 同じ回に仕入れたものは `fetchedAt` が同じなので、第2のキーで並びを固定する。
    orderBy: [{ fetchedAt: "desc" }, { id: "asc" }],
    take,
  });
}

/**
 * 吹き出しの輪へ渡す話題。**例外を外へ出さない**（`resolveChatter()` と同じ理由）。
 *
 * 呼び出し元はお知らせを返すRoute Handlerで、話題が引けなかったせいでお知らせまで返らなく
 * なる方が重い。
 */
export async function topicsForBubble(userId: string, now = new Date()): Promise<TopicBubble[]> {
  try {
    const topics = await recentTopics(userId, now, TOPIC_BUBBLE_LIMIT);
    return topics.map((topic) => ({
      id: topic.id,
      lead: topic.lead,
      title: topic.title,
      url: safeNoticeUrl(topic.url),
      category: topic.category,
    }));
  } catch (error) {
    console.error("[aide-bot] 話題の取得に失敗した", error);
    return [];
  }
}

/**
 * 相談のプロンプトへ添える「最近の話題」の一覧。無ければ空文字。
 *
 * 出典URLも渡す。利用者が「それどこの記事？」と聞いたときに、モデルが作ったURLではなく
 * 仕入れたときの実物を答えられるようにするため。
 */
export async function topicsForChat(userId: string, now = new Date()): Promise<string> {
  let topics: Topic[];
  try {
    topics = await recentTopics(userId, now, TOPIC_CHAT_LIMIT);
  } catch (error) {
    console.error("[aide-bot] 相談の材料になる話題の取得に失敗した", error);
    return "";
  }

  if (topics.length === 0) return "";

  const lines = topics.map((topic) => {
    const source = [topic.sourceName, topic.publishedOn].filter((part) => part !== "").join("・");
    return `- ${topic.title}: ${topic.summary}（${source || "出典"}: ${topic.url}）`;
  });

  return lines.join("\n");
}

/** 「話題」ページに出す一式。 */
export async function topicBoard(userId: string, now = new Date()): Promise<TopicBoard> {
  const [user, topics, latest] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { topicCategories: true } }),
    recentTopics(userId, now, 50),
    db.topic.findFirst({
      where: { userId },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    }),
  ]);

  return {
    categories: parseTopicCategories(user?.topicCategories ?? ""),
    lastFetchedAt: latest?.fetchedAt ?? null,
    topics: topics.map(toRow),
    bubbleLimit: TOPIC_BUBBLE_LIMIT,
    lifetimeHours: TOPIC_LIFETIME_MS / (60 * 60 * 1000),
  };
}

/** 左メニューに出す件数（期間内の話題）。 */
export async function recentTopicCount(userId: string, now = new Date()): Promise<number> {
  return db.topic.count({
    where: { userId, fetchedAt: { gt: new Date(now.getTime() - TOPIC_LIFETIME_MS) } },
  });
}

/**
 * `codex --search exec` へ渡す1本のプロンプト。
 *
 * Codexにはシステムプロンプトを別に渡す口が無い（`buildNoticePrompt()` と同じ）。
 * **JSONだけを返させる。** お知らせ選定（#93）はJSONを避けて行の形にしたが、ここは1件に
 * 5つの項目があり、行の形では区切りが本文に紛れる。コードフェンスで包まれたり前置きが付いたり
 * する揺れは `parseTopics()` 側で吸収する。
 */
function buildTopicPrompt(categories: TopicCategoryId[], now: Date): string {
  const chosen = TOPIC_CATEGORIES.filter((category) => categories.includes(category.id));
  const total = chosen.length * TOPICS_PER_CATEGORY;

  const rules = [
    `いまは日本時間で ${jstStamp(now)} です。直近24時間以内に報じられた記事だけを選ぶ`,
    `種類ごとに${TOPICS_PER_CATEGORY}件、合計${total}件まで。同じ出来事を2件にしない`,
    "報道機関や公式発表など一次情報に近い記事を選ぶ。まとめサイト・SNSの投稿・広告は選ばない",
    "url は検索結果に実在する記事のURLをそのまま書く。作らない・短縮しない",
    "summary は記事に書かれている事実だけを80文字以内で。推測や意見を足さない",
    "lead は秘書が利用者に雑談として話題を振る一言。50文字以内の話し言葉で、「〜だそうです」のように伝聞で書く。" +
      "利用者の事情（住まい・仕事・家族など）を決めつけない。問いかけで終えてもよい。見出し・URL・数字の羅列は入れない",
    "出力はJSONの配列だけ。前置き・説明・コードフェンス・末尾の一文は一切書かない",
  ];

  const shape =
    '[{"category": "general|life|tech", "title": "見出し（40文字以内）", "summary": "要点（80文字以内）", ' +
    '"lead": "秘書の一言（50文字以内）", "url": "https://...", "source": "媒体名", "publishedOn": "YYYY-MM-DD"}]';

  return [
    "あなたは利用者ひとりに付く秘書です。利用者が雑談の話題にできそうな最近のニュースを、ウェブ検索で集めてください。",
    "集める種類:",
    chosen.map((category) => `- ${category.id}（${category.label}）: ${category.scope}`).join("\n"),
    "決まりごと:",
    rules.map((rule) => `- ${rule}`).join("\n"),
    `出力の形:\n${shape}`,
  ].join("\n\n");
}

type ParsedTopic = {
  category: TopicCategoryId;
  title: string;
  summary: string;
  lead: string;
  url: string;
  sourceName: string;
  publishedOn: string;
};

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * モデルの返答からJSON配列を取り出す。**読めない形なら空の配列**（例外にしない）。
 *
 * - コードフェンスや前置きが付いていても、最初の `[` から最後の `]` までを読む
 * - 1件ごとに検証し、壊れた要素は落として残りを使う。全部を捨てると、1件のURLが欠けた
 *   だけでその回の仕入れが無駄になる
 * - `url` は `safeNoticeUrl()` を通し、かつ絶対URL（`http(s)://`）だけを受け付ける。
 *   アプリ内のパス（`/` 始まり）は記事ではない
 * - `category` は今回仕入れる種類に含まれるものだけ。外した種類の記事が混じって来ても入れない
 */
function parseTopics(answer: string, categories: TopicCategoryId[]): ParsedTopic[] {
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  if (start < 0 || end <= start) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const parsed: ParsedTopic[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;

    const category = record.category;
    if (!isTopicCategoryId(category) || !categories.includes(category)) continue;

    const url = safeNoticeUrl(typeof record.url === "string" ? record.url : null);
    if (!url || url.startsWith("/") || seen.has(url)) continue;

    const title = clip(record.title, 120);
    const summary = clip(record.summary, 400);
    const lead = clip(record.lead, 200);
    if (title === "" || summary === "" || lead === "") continue;

    seen.add(url);
    parsed.push({
      category,
      title,
      summary,
      lead,
      url,
      sourceName: clip(record.source, 120),
      publishedOn: /^\d{4}-\d{2}-\d{2}$/.test(clip(record.publishedOn, 10)) ? clip(record.publishedOn, 10) : "",
    });
  }

  return parsed;
}

/**
 * 仕入れを1回走らせ、溜めた件数を返す。**失敗は投げる**（呼び出し元が記録して黙る）。
 *
 * 使った量は、読める形で返ってきたかに関わらず `ApiUsage` へ残す（#133。`conversationId` は
 * 付かない）。上限に掛かった回は `usage` がnullで行が作られない——`turn.completed` が届いて
 * いないので、そこまでの消費量が分からない。
 */
async function fetchTopics(userId: string, categories: TopicCategoryId[], now: Date): Promise<number> {
  const result = await runCodexExec({
    model: TOPIC_MODEL,
    prompt: buildTopicPrompt(categories, now),
    signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
    search: true,
  });

  if (result.usage) {
    await recordApiUsage({ userId, conversationId: null, model: TOPIC_MODEL, usage: result.usage });
  }

  // 打ち切りは上限に掛かったときにしか起きない（この経路に利用者からの割り込みは無い）。
  if (result.interrupted) {
    throw new Error(`話題の仕入れが${CODEX_TIMEOUT_MS / 1000}秒で返らなかった`);
  }
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }

  // `--search` 付きでは「調べます」の一言が先に別の `agent_message` で届く。JSONは最後の1件にある。
  const answer = result.messages.filter((message) => message.trim() !== "").at(-1) ?? "";
  const topics = parseTopics(answer, categories);

  if (topics.length === 0) {
    // 読めない形で返ってきた回。何も溜めないが、失敗としては扱わない——同じ検索をすぐ
    // 叩き直しても結果は変わらない（お知らせ選定の「黙った回」と同じ考え方）。
    console.warn("[aide-bot] 話題の仕入れで読める記事が0件だった", { head: answer.slice(0, 200) });
    return 0;
  }

  // 同じ記事が仕入れ直されたら `fetchedAt` を進めて前へ戻す。upsertなので二重には増えない。
  for (const topic of topics) {
    const { url, sourceName, publishedOn, ...rest } = topic;
    const data = { ...rest, url, sourceName, publishedOn, fetchedAt: now };
    await db.topic.upsert({
      where: { userId_urlHash: { userId, urlHash: urlHashOf(url) } },
      create: { userId, urlHash: urlHashOf(url), ...data },
      update: data,
    });
  }

  return topics.length;
}

/**
 * 仕入れが要るなら走らせる。**必ずすぐ戻る。** 応答を返した後（`after()`）から呼ぶ想定。
 *
 * 走らせない条件は上から順に軽いものから見る。
 *
 * 1. 同じ利用者の仕入れがまだ走っている
 * 2. 前回叩いてから間隔（成功なら1時間・失敗なら15分）があいていない（プロセス内の記録）
 * 3. 仕入れる種類を1つも選んでいない（DBを1回引く。ここで止まれば費用は0）
 * 4. DBの最新の `fetchedAt` から1時間あいていない（プロセスが再起動した直後の歯止め）
 *
 * 失敗はログに残して黙る。吹き出しにも相談にも影響させない（#93「吹き出しにエラーを出さない」）。
 */
export function refreshTopicsIfStale(userId: string, now = new Date()): Promise<void> {
  const attempt = attempts.get(userId);
  if (attempt?.running) return Promise.resolve();

  if (attempt) {
    const interval = attempt.failed ? TOPIC_RETRY_INTERVAL_MS : TOPIC_REFRESH_INTERVAL_MS;
    if (now.getTime() - attempt.at < interval) return Promise.resolve();
  }

  const run = async () => {
    const user = await db.user.findUnique({ where: { id: userId }, select: { topicCategories: true } });
    const categories = parseTopicCategories(user?.topicCategories ?? "");
    if (categories.length === 0) return;

    const latest = await db.topic.findFirst({
      where: { userId },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    });
    if (latest && now.getTime() - latest.fetchedAt.getTime() < TOPIC_REFRESH_INTERVAL_MS) {
      // 再起動の直後など、プロセス内の記録は無いがDB上は仕入れたばかり。記録だけ復元して戻る。
      attempts.set(userId, { at: latest.fetchedAt.getTime(), failed: false, running: false });
      return;
    }

    attempts.set(userId, { at: now.getTime(), failed: false, running: true });
    try {
      const count = await fetchTopics(userId, categories, now);
      console.log(`[aide-bot] 話題を${count}件仕入れた`);
      attempts.set(userId, { at: now.getTime(), failed: false, running: false });
    } catch (error) {
      console.error("[aide-bot] 話題の仕入れに失敗した", error);
      attempts.set(userId, { at: now.getTime(), failed: true, running: false });
    }
  };

  return run().catch((error) => {
    // 種類の読み出しなど、仕入れの前に落ちた回。次の問い合わせでやり直す。
    console.error("[aide-bot] 話題の仕入れの前処理に失敗した", error);
  });
}
