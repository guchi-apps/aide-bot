import { MEMORY_MODEL } from "@/lib/chat-model";
import { runCodexRecorded } from "@/lib/codex-run";
import { db } from "@/lib/db";
import { AUTO_REQUEST_PREFIX } from "@/lib/auto-request";
import { addCandidates, saveNotionResults } from "@/lib/memory";
import {
  buildExtractPrompt,
  buildNotionCheckPrompt,
  parseCandidates,
  parseNotionCheck,
  type NotionCheckResult,
  type SourceMessage,
} from "@/lib/memory-rule";
import { findPreset } from "@/lib/mcp/presets";
import { listConnectedServers, toCodexMcpServers } from "@/lib/mcp/connections";

/**
 * 継続記憶（#323）の候補抽出とNotion照合。**サーバー専用。Codexを呼ぶ。**
 *
 * どちらも**返答を返した後**（`/api/chat` の `after()`）か、記憶の画面のボタンからだけ走る。
 * 往復の中では走らせない（相談の待ち時間を増やさない。#131）。
 */

/** 抽出を走らせる最小の新規発言数。雑談1〜2往復のたびにCodexを呼ばない。 */
const EXTRACT_MIN_NEW_MESSAGES = 3;
/** 抽出の間隔。 */
const EXTRACT_INTERVAL_MS = 10 * 60 * 1000;
/** 1回の抽出で読む発言の上限（新しい方から）。 */
const EXTRACT_WINDOW = 30;
/** 再起動の直後（進み具合を失っているとき）に遡る発言数。重複は一意制約が吸収する。 */
const EXTRACT_COLD_START_WINDOW = 12;
const CODEX_TIMEOUT_MS = 120 * 1000;

/** Notionを確認し直す間隔（1日）と、失敗後に空ける間隔。 */
const NOTION_RECHECK_MS = 24 * 60 * 60 * 1000;
const NOTION_RETRY_MS = 3 * 60 * 60 * 1000;
/** 1回のバックグラウンド確認で見る希望の数。 */
const NOTION_BATCH = 8;

// 進み具合はプロセス内に持つ（`compact.ts` の `running` や `topics.ts` の `attempts` と同じ置き方。
// PM2で1プロセスという前提）。失っても、余分に1回走るだけで済む。
type ExtractState = { cursor: Date | null; lastAttemptAt: number; running: boolean };
const extractStates = new Map<string, ExtractState>();
const notionFailedAt = new Map<string, number>();
const notionRunning = new Set<string>();

/**
 * 直近の利用者の発言から、記憶の候補を抽出する。**例外を外へ出さない**（返答の後始末）。
 * 出典は利用者の発言だけ。秘書の側が積んだ自動の依頼文（`（自動）`）は利用者の言葉ではないので外す。
 */
export async function extractCandidatesIfDue(userId: string, conversationId: string, now = new Date()): Promise<void> {
  const state = extractStates.get(userId) ?? { cursor: null, lastAttemptAt: 0, running: false };
  extractStates.set(userId, state);

  if (state.running || now.getTime() - state.lastAttemptAt < EXTRACT_INTERVAL_MS) return;

  state.running = true;
  try {
    const rows = await db.message.findMany({
      where: {
        conversationId,
        role: "USER",
        ...(state.cursor ? { createdAt: { gt: state.cursor } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: state.cursor ? EXTRACT_WINDOW : EXTRACT_COLD_START_WINDOW,
      select: { id: true, content: true, createdAt: true },
    });

    const sources: SourceMessage[] = rows
      .filter((row) => !row.content.startsWith(AUTO_REQUEST_PREFIX))
      .reverse();
    if (sources.length < EXTRACT_MIN_NEW_MESSAGES) return;

    state.lastAttemptAt = now.getTime();

    const result = await runCodexRecorded({
      userId,
      conversationId,
      feature: "memory",
      label: "継続記憶の候補の抽出",
      model: MEMORY_MODEL,
      prompt: buildExtractPrompt(sources),
      timeoutMs: CODEX_TIMEOUT_MS,
    });

    const candidates = parseCandidates(result.reply, sources);
    const added = await addCandidates(userId, candidates);
    if (added > 0) console.info(`[aide-bot] 継続記憶の候補を${added}件足した`);

    // 読み終えた発言までを進める。失敗した回は進めない（次の間隔の後にやり直せる）。
    state.cursor = sources[sources.length - 1].createdAt;
  } catch (error) {
    console.error("[aide-bot] 継続記憶の候補の抽出に失敗した", error);
  } finally {
    state.running = false;
  }
}

/** 繋いでいるNotionの接続。無ければnull。 */
async function notionServers(userId: string) {
  const servers = (await listConnectedServers(userId)).filter((server) => findPreset(server.url)?.id === "notion");
  return servers.length === 0 ? null : servers;
}

/**
 * 確定した「行きたい・やりたい」のNotionでの状態を調べて保存する。**読むだけ**（書き込みの道具は
 * 止めて渡す）。見つからなかった回・読めなかった項目は、状態を書き換えない（推測しない）。
 * Notionへ繋がっていなければ投げる（呼び出し元が「確認できない」として扱う）。
 */
export async function checkNotionStates(
  userId: string,
  targets: { id: string; content: string }[],
): Promise<Map<string, NotionCheckResult>> {
  if (targets.length === 0) return new Map();

  const servers = await notionServers(userId);
  if (!servers) throw new Error("Notionへ繋がっていないため、状態を確認できません。");

  const { mcpServers } = toCodexMcpServers(servers, false);

  const result = await runCodexRecorded({
    userId,
    feature: "memory",
    label: "継続記憶のNotion照合",
    model: MEMORY_MODEL,
    prompt: buildNotionCheckPrompt(targets),
    timeoutMs: CODEX_TIMEOUT_MS,
    mcpServers,
  });

  const states = parseNotionCheck(
    result.reply,
    targets.map((target) => target.id),
  );
  await saveNotionResults(userId, states, new Date());
  return states;
}

/**
 * 相談の後に、古くなった照合をまとめて取り直す。**例外を外へ出さない。**
 * Notionで達成・見送りになった希望を、古い会話を根拠に「未実施」として扱い続けないための保険。
 */
export async function refreshStaleNotionStates(userId: string, now = new Date()): Promise<void> {
  if (notionRunning.has(userId)) return;
  const failed = notionFailedAt.get(userId);
  if (failed !== undefined && now.getTime() - failed < NOTION_RETRY_MS) return;

  notionRunning.add(userId);
  try {
    const stale = await db.memory.findMany({
      where: {
        userId,
        status: "CONFIRMED",
        kind: "WISH",
        OR: [{ notionCheckedAt: null }, { notionCheckedAt: { lt: new Date(now.getTime() - NOTION_RECHECK_MS) } }],
      },
      orderBy: [{ notionCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      take: NOTION_BATCH,
      select: { id: true, content: true },
    });
    if (stale.length === 0) return;

    // Notionを繋いでいない利用者には何もしない（失敗として数えない）。
    if (!(await notionServers(userId))) return;

    await checkNotionStates(userId, stale);
    notionFailedAt.delete(userId);
  } catch (error) {
    notionFailedAt.set(userId, now.getTime());
    console.error("[aide-bot] 継続記憶のNotion照合に失敗した", error);
  } finally {
    notionRunning.delete(userId);
  }
}

export type NotionRecordResult =
  | { status: "created"; url: string | null }
  /** すでにNotionにあった。追加しない。 */
  | { status: "exists"; notion: NotionCheckResult };

/**
 * 確定した希望をNotionの「いつかやりたいこと」へ記録する。**利用者が押したときだけ**。
 *
 * 書く前に必ず照合し直す。**すでにある（達成・見送りを含む）なら書かずにリンクだけを紐づける**
 * ——会話の記憶とNotionに同じ希望の別正本を作らない。照合できなかったときは書かない。
 */
export async function recordWishToNotion(userId: string, id: string): Promise<NotionRecordResult> {
  const memory = await db.memory.findFirst({
    where: { id, userId, kind: "WISH", status: "CONFIRMED" },
    select: { id: true, content: true },
  });
  if (!memory) throw new Error("記録できる「行きたい・やりたい」の記憶が見つかりません。");

  const states = await checkNotionStates(userId, [memory]);
  const found = states.get(memory.id);
  if (!found) throw new Error("Notionの状態を読み取れなかったので、記録しませんでした。");
  if (found.status !== "not_found") return { status: "exists", notion: found };

  const servers = await notionServers(userId);
  if (!servers) throw new Error("Notionへ繋がっていません。");
  // ここだけ書き込みの道具を渡す。
  const { mcpServers } = toCodexMcpServers(servers, true);

  const result = await runCodexRecorded({
    userId,
    feature: "memory",
    label: "継続記憶のNotionへの記録",
    model: MEMORY_MODEL,
    prompt: [
      "利用者のNotionの「いつかやりたいこと」（行きたい場所・やりたいことのリスト）に、次の1件を追加してください。",
      "同じ内容の項目がすでにあれば追加せず、その項目のURLだけを返してください。追加するのは1件だけで、他のページは変更しないでください。",
      "項目の名前は次の文をそのまま使い、状態の欄があれば未実施の状態にしてください。",
      `項目: ${memory.content}`,
      "",
      '出力はJSONオブジェクトのみ: {"result":"created または exists","url":"項目のURL"}',
    ].join("\n"),
    timeoutMs: CODEX_TIMEOUT_MS,
    mcpServers,
  });

  const start = result.reply.indexOf("{");
  const end = result.reply.lastIndexOf("}");
  let parsed: { result?: unknown; url?: unknown } = {};
  try {
    parsed = JSON.parse(result.reply.slice(start, end + 1));
  } catch {
    // 読めなかった。書けたかどうか分からないので、失敗として返す。
  }
  if (parsed.result !== "created" && parsed.result !== "exists") {
    throw new Error("Notionへ記録できたか確認できませんでした。Notionを開いて確かめてください。");
  }

  const url = typeof parsed.url === "string" && /^https:\/\//.test(parsed.url) ? parsed.url.slice(0, 500) : null;
  await saveNotionResults(userId, new Map([[memory.id, { status: "open", url }]]), new Date());

  return parsed.result === "created"
    ? { status: "created", url }
    : { status: "exists", notion: { status: "open", url } };
}
