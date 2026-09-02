import { NextResponse } from "next/server";

import { INTERRUPTED_NOTE, historyWindowSkip, secretarySystemPrompt } from "@/lib/anthropic";
import { getCurrentUser } from "@/lib/auth-user";
import type { ReplyStyle } from "@/lib/chat-model";
import { selectedChatModels } from "@/lib/chat-model-server";
import { runCodexExec } from "@/lib/codex";
import { MAX_MESSAGE_LENGTH, buildConversationTitle } from "@/lib/conversation";
import { db } from "@/lib/db";
import { topicsForChat } from "@/lib/topics";
import { recordApiUsage } from "@/lib/usage";

/**
 * 相談（チャット）の返答生成（#128）。
 *
 * **返答の生成元はAnthropic ClaudeからCodex（ChatGPTサブスク経由）に変わった。**
 * MCP接続によるデータ取得と書き込みの道具は、このスコープでは対象外（Issue #128の計画を参照）。
 *
 * **使用量（`ApiUsage`）の記録は#133で戻した。** Codexはサブスク定額で費用が付かないが、
 * `codex exec --json` の `turn.completed` がトークン数を返すため、`/usage` の「相談・お知らせ」
 * の節に量として出す。**費用が0になるのは単価表を引かないから**で、記録しないからではない
 * （`billingKind()`。`@/lib/chat-model`）。
 *
 * **`codex exec` はトークン単位でストリーミングしない**（`@/lib/codex`）。応答が完結して
 * から `delta` イベントを1回だけ送るため、届いた端から文字が増えていく従来の見え方はしない。
 * **割り込み（#48）ても、そこまでの本文は保存できない**（本文は完了時にしか届かないため）。
 */

// 返答を逐次流すため、実行のたびに動的に扱わせる。
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  conversationId?: string | null;
  message?: unknown;
  /** `voice` なら音声モード。返答の体裁だけが変わり、保存の仕方は同じ（#27）。 */
  mode?: unknown;
};

const encoder = new TextEncoder();

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 生成中のスレッドと、その後片付けが終わるまでのプロミス（#48）。
 *
 * 利用者は返答の途中でも次の発言を送れる。そのとき走っている生成は打ち切られるが、
 * **保存されるのは打ち切られた側のリクエストの中**なので、割り込んだリクエストが先に
 * 発言を保存すると、遮られた返答の方が後ろの時刻で入る。一覧は `createdAt` 順に並べるため、
 * 再読み込みしたときに秘書の返答が自分の次の発言より下へ回る。
 *
 * 同じスレッドの生成が畳まれるまで、次のリクエストをここで待たせて順序を保つ。
 * プロセス内のMapで足りるのは、PM2で1プロセスしか動かさないため（`deploy/ecosystem.config.js`）。
 */
const pendingGenerations = new Map<string, Promise<void>>();

/** 待つ上限。生成側が畳み損ねても、次の発言をここで止め続けない。 */
const PENDING_WAIT_MS = 5000;

async function waitForPendingGeneration(conversationId: string): Promise<void> {
  const pending = pendingGenerations.get(conversationId);
  if (!pending) return;

  await Promise.race([
    pending,
    new Promise<void>((resolve) => setTimeout(resolve, PENDING_WAIT_MS)),
  ]);
}

/**
 * 保存してある発言を、Codexへ渡す1本の会話テキストへ均す。
 *
 * 保存された並びは、そのままでは頭がassistantの発言になることがある（`HISTORY_LIMIT` で
 * 頭を切るため）。ここで先頭を落とし、続いた同じ役割はまとめる。あわせて、割り込まれた
 * 返答には注記を添える（#48）。DBの本文はそのまま画面へ出すため汚さず、モデルへ渡すときに
 * だけ「ここで遮られた」と分かる形にする。
 */
function buildConversationText(
  entries: { role: "USER" | "ASSISTANT"; content: string; interrupted: boolean }[],
): string {
  const merged: { role: "user" | "assistant"; content: string }[] = [];

  for (const entry of entries) {
    const role = entry.role === "USER" ? ("user" as const) : ("assistant" as const);

    if (merged.length === 0 && role !== "user") continue;

    const content =
      role === "assistant" && entry.interrupted
        ? `${entry.content}\n\n${INTERRUPTED_NOTE}`
        : entry.content;

    const last = merged[merged.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
      continue;
    }

    merged.push({ role, content });
  }

  return merged.map((entry) => `${entry.role === "user" ? "利用者" : "秘書"}: ${entry.content}`).join("\n\n");
}

/**
 * Codexへ渡す1本のプロンプト。体裁の指示・これまでの会話・最近の話題・今回の依頼をまとめる。
 *
 * **最近の話題（#144）は履歴の後ろに置く。** 仕入れは1時間に1回まで変わるので、前に置くと
 * そのたびにプレフィックスの先頭側が変わり、履歴ぶんのキャッシュ（#56・#128）が丸ごと外れる。
 * 後ろなら履歴までは前方一致のまま乗る。
 */
function buildCodexPrompt(
  style: ReplyStyle,
  history: { role: "USER" | "ASSISTANT"; content: string; interrupted: boolean }[],
  topics: string,
): string {
  const system = secretarySystemPrompt(style);
  const conversation = buildConversationText(history);

  return [
    system,
    "---",
    "これまでの会話:",
    conversation,
    ...(topics === ""
      ? []
      : [
          "---",
          "最近の話題（あなたがウェブで仕入れておいたニュース。利用者が世の中の話・雑談・「何かニュースある？」を" +
            "求めたときの材料にする。頼まれていないのに持ち出さない。要点は仕入れたときの要約なので、" +
            "詳しく聞かれたら出典の記事を案内し、書かれていない細部を作らない）:",
          topics,
        ]),
    "---",
    "直近の利用者の発言に対する、秘書としての返答だけを書いてください。" +
      "「秘書:」のような役割ラベルや前置きは書かず、本文だけを返してください。",
  ].join("\n\n");
}

/**
 * 相談の送信を受け、発言を保存しつつ秘書の返答をストリーミングで返す。
 *
 * proxy.ts は `/api/*` をリダイレクトせず素通しする設計のため、ログイン判定はここで行う。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return fail("ログインが必要です。", 401);
  }

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return fail("リクエストの形式が正しくありません。", 400);
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message === "") {
    return fail("相談したい内容を入力してください。", 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return fail(`一度に送れるのは${MAX_MESSAGE_LENGTH.toLocaleString()}文字までです。`, 400);
  }

  // 割り込みで打ち切られた生成が、そこまでの返答を保存し終えるのを待つ（#48）。
  // 待たずに進めると、遮られた返答が今回の発言より後ろの時刻で入り、並びが入れ替わる。
  if (body.conversationId) {
    await waitForPendingGeneration(body.conversationId);
  }

  // 他人のスレッドへ書き込めないよう、必ずuserIdとの組で引く。
  const conversation = body.conversationId
    ? await db.conversation.findFirst({
        where: { id: body.conversationId, userId: user.id },
        select: { id: true, title: true },
      })
    : await db.conversation.create({
        data: { userId: user.id, title: buildConversationTitle(message) },
        select: { id: true, title: true },
      });

  if (!conversation) {
    return fail("その相談は見つかりませんでした。", 404);
  }

  await db.$transaction([
    db.message.create({
      data: { conversationId: conversation.id, role: "USER", content: message },
    }),
    // 一覧の並び順はこの列だけを見ている。発言を足しただけでは動かないので明示的に触る。
    db.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    }),
  ]);

  // 窓の先頭は `HISTORY_WINDOW_STEP` の刻みでしか動かさない。1発言ずつ滑らせると
  // 往復のたびにプレフィックスの先頭が変わり、Codex側のキャッシュ（実測で確認済み。
  // `turn.completed` の `usage.cached_input_tokens`）が効きにくくなる。
  const messageCount = await db.message.count({ where: { conversationId: conversation.id } });

  const history = await db.message.findMany({
    where: { conversationId: conversation.id },
    // 並びが揺れればプレフィックスも揺れる。`createdAt` が同じ発言があっても毎回同じ順で
    // 並ぶよう、第2のキーにidを置く。
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: historyWindowSkip(messageCount),
    select: { role: true, content: true, interrupted: true },
  });

  // 音声で聞くかどうかはこの1往復ぶんの都合なので、スレッドには持たせず毎回受け取る。
  const style: ReplyStyle = body.mode === "voice" ? "voice" : "text";

  // 返答に使うモデルは、この端末が設定の画面で選んだもの。話すときと書くときで別々に持てる。
  const model = (await selectedChatModels())[style];

  // 仕入れてある話題（#144）。DBを引くだけで、無ければ空文字（プロンプトの形は変わらない）。
  const topics = await topicsForChat(user.id);

  const prompt = buildCodexPrompt(style, history, topics);

  // 次に割り込んでくるリクエストへ「この生成の後片付けが終わった」と伝えるための錠（#48）。
  // ストリームの外で作るのは、`start` が動くより先にMapへ載せておく必要があるため。
  let releasePending = () => {};
  const pending = new Promise<void>((resolve) => {
    releasePending = resolve;
  });
  pendingGenerations.set(conversation.id, pending);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 新規スレッドのIDは、これを受け取るまでクライアント側が知らない。最初に流す。
        controller.enqueue(sse("meta", { conversationId: conversation.id, title: conversation.title }));

        let answer = "";
        let errorMessage: string | null = null;
        // 利用者に遮られたか。割り込んだ側の発言に答えられるよう、保存時に印を付ける（#48）。
        let interrupted = false;

        try {
          const result = await runCodexExec({ model, prompt, signal: request.signal });
          answer = result.text;
          interrupted = result.interrupted;
          errorMessage = result.errorMessage;

          // 使った量は返答の保存とは独立に残す（#51「1呼び出し＝1行」）。中断・起動失敗で
          // `turn.completed` が届かなかった回は `usage` がnullになり、行は作られない。
          if (result.usage) {
            await recordApiUsage({
              userId: user.id,
              conversationId: conversation.id,
              model,
              usage: result.usage,
            });
          }

          // `codex exec` は応答が完結してからしか本文を返さないため、ここで1回だけ流す
          // （届いた端から逐次表示する形にはならない）。
          if (answer !== "") {
            controller.enqueue(sse("delta", { text: answer }));
          }
        } catch (error) {
          console.error("[aide-bot] 返答の生成に失敗した", error);
          errorMessage = "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
        }

        // 途中で切れていても、そこまでの返答は残す。消えると何を聞いたかだけが残る。
        // ただし `codex exec` は完了時にしか本文を返さないため、中断時はここが空になりやすい。
        if (answer.trim() !== "") {
          try {
            await db.$transaction([
              db.message.create({
                data: {
                  conversationId: conversation.id,
                  role: "ASSISTANT",
                  content: answer,
                  interrupted,
                },
              }),
              db.conversation.update({
                where: { id: conversation.id },
                data: { updatedAt: new Date() },
              }),
            ]);
          } catch (error) {
            console.error("[aide-bot] 返答の保存に失敗した", error);
            errorMessage ??= "返答を保存できませんでした。この内容は再読み込みで消えます。";
          }
        }

        // 相手が既にいない場合、enqueue/closeは例外になる。伝える相手がいないだけなので黙って畳む。
        try {
          controller.enqueue(errorMessage ? sse("error", { message: errorMessage }) : sse("done", {}));
          controller.close();
        } catch {
          // 何もしない
        }
      } finally {
        // 待たせている割り込みを通す。返答の保存が済んだこの時点で外すこと（#48）。
        // 途中で投げても必ず外れるよう、finallyから呼ぶ。
        if (pendingGenerations.get(conversation.id) === pending) {
          pendingGenerations.delete(conversation.id);
        }
        releasePending();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform が無いと、間に挟まるプロキシが応答をまとめてしまい逐次表示にならない。
      "Cache-Control": "no-store, no-transform",
      // 逆に間のプロキシへ「溜めるな」と伝える。効くのはnginxだけだが害はない。
      "X-Accel-Buffering": "no",
    },
  });
}
