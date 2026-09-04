import { compactSystemPrompt } from "@/lib/anthropic";
import { COMPACT_MODEL } from "@/lib/chat-model";
import { runCodexExec } from "@/lib/codex";
import { db } from "@/lib/db";
import { recordApiUsage } from "@/lib/usage";

/**
 * 連続セッションの古い発言を要約へ畳む（#157のcompact）。**サーバー専用。**
 *
 * 相談をテーマごとに分けなくなったので、**畳まないかぎり1本の記録が伸び続ける。**
 * 履歴の窓（`HISTORY_LIMIT`。`@/lib/anthropic`）で頭を切るだけだと、切り落とした側の
 * 文脈がどこにも残らず、「先週お願いした件」がモデルから見えなくなる。
 *
 * 畳むのは**返答を返した後**（`/api/chat` が `after()` で起こす）。往復の中で待たせると、
 * 数十発言に一度だけ返事が数十秒遅れる相談ができる。
 */

/**
 * 要約していない発言がこれを超えた回に畳む。
 *
 * `HISTORY_LIMIT`（40）と同じ値にしてある。**普段は「要約していない発言」がまるごと
 * 履歴の窓に収まる**状態を保ちたいため——超えた回にだけ畳めば、窓から溢れる発言は
 * 次の往復までの一時的なものになる。
 */
export const COMPACT_THRESHOLD = 40;

/**
 * 畳まずに残す直近の発言数。
 *
 * ここを小さくすると、畳んだ直後の返答が要約だけを頼りに書かれることになり、
 * 「さっき言ったこと」の細部が落ちる。8往復ぶんを目安に残す。
 */
export const COMPACT_KEEP = 16;

/** 要約の長さの上限（文字）。プロンプトの指示と、切り詰めの両方で使う。 */
const SUMMARY_MAX_LENGTH = 1200;

/**
 * 畳むのを打ち切る時間。
 *
 * この経路は返答を返した後に走るので、詰まっても利用者は待たされない。**それでも上限を
 * 置くのは、返らないプロセスが積み上がるのを避けるため**（#132のお知らせ選定と同じ理由）。
 */
const CODEX_TIMEOUT_MS = 120 * 1000;

/**
 * いま畳んでいる相談。
 *
 * 割り込み（#48）で往復が重なると、同じ相談に対して畳む処理が二重に走りうる。両方が
 * 同じ発言を畳んで `summarizedCount` を2回進めると、**まだ畳んでいない発言まで
 * 要約済みとして読み飛ばされる。** プロセス内のSetで足りるのは、PM2で1プロセスしか
 * 動かさないため（`pendingGenerations`。`src/app/api/chat/route.ts` と同じ前提）。
 */
const running = new Set<string>();

/** 畳む対象の発言を、モデルへ渡す1本のテキストにする。 */
function foldedText(messages: { role: "USER" | "ASSISTANT"; content: string }[]): string {
  return messages
    .map((message) => `${message.role === "USER" ? "利用者" : "秘書"}: ${message.content}`)
    .join("\n\n");
}

function buildPrompt(previous: string | null, folded: string): string {
  return [
    compactSystemPrompt(SUMMARY_MAX_LENGTH),
    "---",
    "これまでの要約:",
    previous ?? "（まだありません。これが最初の要約です）",
    "---",
    "そこに続く会話:",
    folded,
  ].join("\n\n");
}

/**
 * 必要なら古い発言を要約へ畳む。**例外を外へ出さない。**
 *
 * 呼び出し元は返答を返し終えた後の後始末で、ここで投げても伝える相手がいない。畳めなかった
 * 回は `summarizedCount` を進めないので、次の往復でやり直せる（#79「生成に失敗した日は
 * 記録を残さない」と同じ考え方）。
 */
export async function compactIfNeeded(params: {
  userId: string;
  conversationId: string;
  /** いまの要約。まだ一度も畳んでいなければnull。 */
  summary: string | null;
  /** すでに要約へ畳んだ発言の数。 */
  summarizedCount: number;
  /** その相談の発言の総数。 */
  totalMessages: number;
}): Promise<boolean> {
  const { userId, conversationId, summary, summarizedCount, totalMessages } = params;

  const pending = totalMessages - summarizedCount;
  if (pending <= COMPACT_THRESHOLD) return false;
  if (running.has(conversationId)) return false;

  running.add(conversationId);

  try {
    const foldCount = pending - COMPACT_KEEP;

    // 並びは `/api/chat` の履歴と同じキーで固定する。揺れると、畳んだ発言と履歴へ渡す
    // 発言の境目がずれ、同じ発言が二重に入るか抜け落ちる。
    const messages = await db.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: summarizedCount,
      take: foldCount,
      select: { role: true, content: true },
    });

    // 数え直した結果が合わなければ何もしない。畳む対象が変わっているということなので、
    // 数の食い違ったまま `summarizedCount` を進める方が害が大きい。
    if (messages.length !== foldCount) return false;

    const result = await runCodexExec({
      model: COMPACT_MODEL,
      prompt: buildPrompt(summary, foldedText(messages)),
      signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
    });

    if (result.usage) {
      await recordApiUsage({ userId, conversationId, model: COMPACT_MODEL, usage: result.usage });
    }

    // 打ち切りは上限に掛かったときにしか起きない（この経路に利用者からの割り込みは無い）。
    if (result.interrupted) {
      console.error(`[aide-bot] 記録の要約が${CODEX_TIMEOUT_MS / 1000}秒で返らなかった`);
      return false;
    }
    if (result.errorMessage) {
      console.error("[aide-bot] 記録の要約に失敗した", result.errorMessage);
      return false;
    }

    const text = result.text.trim();
    if (text === "") return false;

    // 上限は指示にも書いてあるが、超えて返ってきた回をそのまま溜めると、往復のたびに
    // 送る要約が伸び続ける。要約は畳むためのものなので、必ずここで切る。
    const next = Array.from(text).slice(0, SUMMARY_MAX_LENGTH).join("");

    await db.conversation.update({
      where: { id: conversationId },
      data: { summary: next, summarizedCount: summarizedCount + foldCount },
    });

    return true;
  } catch (error) {
    console.error("[aide-bot] 記録の要約に失敗した", error);
    return false;
  } finally {
    running.delete(conversationId);
  }
}
