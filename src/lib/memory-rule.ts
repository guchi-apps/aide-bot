import { createHash } from "node:crypto";

import { jstDayKey } from "@/lib/day-key";
import {
  MEMORY_KIND_LABELS,
  NOTION_FRESH_MS,
  type MemoryConfidenceName,
  type MemoryKindName,
  type MemoryStatusName,
} from "@/lib/memory-labels";

/**
 * 継続記憶（#323）の、DBにもCodexにも触れない判定。**純粋な関数だけ。**
 *
 * 抽出結果の読み違い（出典の無い候補を通す・秘密情報を残す）と、回答へ載せる条件の食い違い
 * （忘れたはずの記憶が載る）は画面に出ないまま効くので、テストで固定できるよう切り出してある。
 */

export const MEMORY_CONTENT_MAX = 200;
export const MEMORY_QUOTE_MAX = 200;
/** 1回の抽出で受け付ける候補の数。 */
export const MAX_CANDIDATES_PER_RUN = 5;

/** Notion側の状態。 */
export const NOTION_STATES = ["open", "done", "skipped", "not_found"] as const;
export type NotionState = (typeof NOTION_STATES)[number];

/** 本文の正規化。空白・句読点・大文字小文字・全半角の違いで別の記憶にしない。 */
export function normalizeContent(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

export function dedupeKeyOf(content: string): string {
  return createHash("sha256").update(normalizeContent(content)).digest("hex");
}

// 秘密情報らしい語・形。**取りこぼすより、誤って落とす方を選ぶ**（記憶は後から手で足せる）。
const SECRET_PATTERNS: RegExp[] = [
  /パスワード|暗証番号|認証コード|秘密鍵|マイナンバー|シークレット|クレジットカード|カード番号/,
  /\b(password|passwd|pwd|secret|api[_-]?key|access[_-]?token|token|private[_-]?key)\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /\bop:\/\//,
  /[A-Za-z0-9+/_-]{40,}/,
  /\b(?:\d[ -]?){13,19}\b/,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function truncate(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/** 抽出の材料にする発言。 */
export type SourceMessage = { id: string; content: string; createdAt: Date };

export type ParsedCandidate = {
  kind: MemoryKindName;
  content: string;
  confidence: MemoryConfidenceName;
  sourceMessageId: string;
  sourceQuote: string;
  sourceAt: Date;
  dedupeKey: string;
};

const KINDS = new Set<string>(["WISH", "DECISION", "ONGOING"]);
const CONFIDENCES = new Set<string>(["HIGH", "MEDIUM", "LOW"]);

/** 返答の中のJSON配列を取り出す。前後に文や```が付いていても読む。 */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * 抽出の返答を候補へ読む。
 *
 * - **出典は利用者の発言に限る。** `sourceId` が渡した発言に無ければ捨てる（秘書の返答や作り話を
 *   根拠にしない）。引用と日時はモデルの文ではなく、**実際の発言**から取る
 * - 本文・引用に秘密情報らしいものが入っていれば捨てる
 * - 読めない形は空配列（何も残さない）
 */
export function parseCandidates(text: string, sources: SourceMessage[]): ParsedCandidate[] {
  const items = extractJsonArray(text);
  if (!items) return [];

  const byId = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  const result: ParsedCandidate[] = [];

  for (const item of items) {
    if (result.length >= MAX_CANDIDATES_PER_RUN) break;
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;

    const kind = typeof row.kind === "string" ? row.kind.toUpperCase() : "";
    if (!KINDS.has(kind)) continue;

    const content = typeof row.content === "string" ? truncate(row.content.trim(), MEMORY_CONTENT_MAX) : "";
    if (content === "") continue;

    const source = typeof row.sourceId === "string" ? byId.get(row.sourceId) : undefined;
    if (!source) continue;

    if (containsSecret(content) || containsSecret(source.content)) continue;

    const key = dedupeKeyOf(content);
    if (seen.has(key)) continue;
    seen.add(key);

    const confidence = typeof row.confidence === "string" ? row.confidence.toUpperCase() : "";

    result.push({
      kind: kind as MemoryKindName,
      content,
      // 読めない確度は低に倒す（高く見せない）。
      confidence: CONFIDENCES.has(confidence) ? (confidence as MemoryConfidenceName) : "LOW",
      sourceMessageId: source.id,
      sourceQuote: truncate(source.content.trim(), MEMORY_QUOTE_MAX),
      sourceAt: source.createdAt,
      dedupeKey: key,
    });
  }

  return result;
}

/** 候補抽出のプロンプト。 */
export function buildExtractPrompt(messages: SourceMessage[]): string {
  const lines = messages.map((message) => `[${message.id}] ${message.content.replace(/\s+/g, " ").trim()}`);

  return [
    "あなたは利用者の秘書の記憶係です。次の「利用者の発言」から、会話が終わった後も覚えておく価値がある" +
      "継続的なもの（本人が続けてほしい希望・判断・進行中の用件）だけを候補として抜き出してください。",
    "",
    "種類（kind）:",
    "- WISH: 行きたい場所・やりたいこと（いつかやりたいこと）",
    "- DECISION: 本人が決めたこと・今後も続けてほしい方針や好み",
    "- ONGOING: 進行中で、後から続きを話す用件",
    "",
    "守ること:",
    "- 雑談・その場限りの質問・仮の話（「〜かも」「〜だったらいいな」の思いつき）・他人の話は抜き出さない。迷ったら抜き出さない",
    "- パスワード・トークン・APIキー・カード番号・住所や口座などの秘密情報は、絶対に抜き出さない",
    "- 予定・タスクの現在状態は別の場所が正本なので、状態そのもの（今日の予定など）は抜き出さない",
    `- content は利用者の言葉を尊重した1文（${MEMORY_CONTENT_MAX}文字以内）。書かれていないことを足さない`,
    "- sourceId は根拠にした発言の [ ] 内のIDをそのまま書く。根拠が無いものは出さない",
    "- confidence は、本人がはっきり言い切っていれば HIGH、言い方から読み取ったなら MEDIUM、あいまいなら LOW",
    `- 最大${MAX_CANDIDATES_PER_RUN}件。無ければ [] だけを返す`,
    "",
    '出力はJSON配列のみ（前置き・説明・コードブロックは書かない）: [{"kind":"WISH","content":"…","confidence":"HIGH","sourceId":"…"}]',
    "",
    "利用者の発言:",
    ...lines,
  ].join("\n");
}

/** Notionの状態確認の対象1件。 */
export type NotionCheckTarget = { id: string; content: string };

export function buildNotionCheckPrompt(targets: NotionCheckTarget[]): string {
  return [
    "利用者のNotionにある「いつかやりたいこと」（行きたい場所・やりたいことのリスト）から、" +
      "次の各項目に当たるものを探し、いまの状態を調べてください。Notionへ書き込んではいけません（読むだけ）。",
    "",
    "状態（status）:",
    "- open: 見つかり、まだ実施していない・検討中",
    "- done: 見つかり、達成・実施済み（完了・行った・やった）",
    "- skipped: 見つかり、見送り・やめた・対象外",
    "- not_found: 探したが、同じ内容の項目は見つからなかった",
    "似ているだけの別の項目は同じ扱いにしない。状態の欄が読み取れないときは推測せず、その項目は出力に含めない。",
    "見つかった項目のページURLがあれば url に入れる。",
    "",
    '出力はJSON配列のみ（前置き・説明は書かない）: [{"id":"…","status":"open","url":"https://…"}]',
    "",
    "項目:",
    ...targets.map((target) => `[${target.id}] ${target.content}`),
  ].join("\n");
}

export type NotionCheckResult = { status: NotionState; url: string | null };

/** 状態確認の返答を読む。対象に無いID・知らない状態は捨てる。 */
export function parseNotionCheck(text: string, ids: string[]): Map<string, NotionCheckResult> {
  const result = new Map<string, NotionCheckResult>();
  const items = extractJsonArray(text);
  if (!items) return result;

  const allowed = new Set(ids);

  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !allowed.has(row.id)) continue;
    if (typeof row.status !== "string" || !(NOTION_STATES as readonly string[]).includes(row.status)) continue;

    const url = typeof row.url === "string" && /^https:\/\//.test(row.url) ? row.url.slice(0, 500) : null;
    result.set(row.id, { status: row.status as NotionState, url });
  }

  return result;
}

/** 回答の根拠に使える記憶の形（プロンプト整形が読む列）。 */
export type PromptMemory = {
  kind: MemoryKindName;
  content: string;
  status: MemoryStatusName;
  sourceAt: Date;
  updatedAt: Date;
  notionStatus: string | null;
  notionCheckedAt: Date | null;
};

/**
 * 回答の根拠から外す記憶か。
 *
 * **確定以外（候補・見送り・忘れた）は使わない。** さらに、Notionが達成・見送りと答えている
 * 希望は、古い会話を根拠に「まだやっていないこと」として扱わない（Notionが正本）。
 */
export function isUsableForAnswer(memory: PromptMemory): boolean {
  if (memory.status !== "CONFIRMED") return false;
  if (memory.notionStatus === "done" || memory.notionStatus === "skipped") return false;
  return true;
}

function notionNote(memory: PromptMemory, now: Date): string | null {
  if (memory.kind !== "WISH") return null;
  if (memory.notionStatus === "not_found") return "Notionには未登録";
  if (memory.notionStatus === "open" && memory.notionCheckedAt) {
    return now.getTime() - memory.notionCheckedAt.getTime() <= NOTION_FRESH_MS
      ? `Notionでは未実施（${jstDayKey(memory.notionCheckedAt)}に確認）`
      : `Notionでの状態は${jstDayKey(memory.notionCheckedAt)}以降確認できていない`;
  }
  return "Notionでの状態は確認できていない";
}

/**
 * 相談のプロンプトへ載せる「継続記憶」のブロック。使える記憶が無ければ空文字（形を変えない）。
 * 各行に、元の発言の日と更新日を添えて出典を辿れるようにする。
 */
export function formatMemoryBlock(memories: PromptMemory[], now: Date): string {
  const lines = memories.filter(isUsableForAnswer).map((memory) => {
    const parts = [`元の発言 ${jstDayKey(memory.sourceAt)}`, `更新 ${jstDayKey(memory.updatedAt)}`];
    const note = notionNote(memory, now);
    if (note) parts.push(note);
    return `- [${MEMORY_KIND_LABELS[memory.kind]}] ${memory.content}（${parts.join("・")}）`;
  });

  return lines.join("\n");
}

/** 記憶を引けなかったときに、プロンプトへ入れる断り。「覚えていない」と断定させない。 */
export const MEMORY_UNAVAILABLE_NOTE =
  "継続記憶を取得できませんでした。過去の希望や決定を聞かれたら、「覚えていない」と言わず、" +
  "いまは記憶を確認できないと伝える。";
