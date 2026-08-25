import type Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import {
  CHAT_MODEL,
  HISTORY_LIMIT,
  INTERRUPTED_NOTE,
  getAnthropicClient,
  maxOutputTokens,
  secretarySystemPrompt,
  type ReplyStyle,
} from "@/lib/anthropic";
import { getCurrentUser } from "@/lib/auth-user";
import { MAX_MESSAGE_LENGTH, buildConversationTitle } from "@/lib/conversation";
import { db } from "@/lib/db";

// 返答を逐次流すため、実行のたびに動的に扱わせる。
export const dynamic = "force-dynamic";

type ChatRequestBody = {
  conversationId?: string | null;
  message?: unknown;
  /** `voice` なら音声モード。返答の形だけが変わり、保存の仕方は同じ（#27）。 */
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
 * 利用者は返答の途中でも次の発言を送れる。そのとき走っている生成は打ち切られ、そこまでの
 * 返答が保存されるが、**保存されるのは打ち切られた側のリクエストの中**なので、割り込んだ
 * リクエストが先に発言を保存すると、遮られた返答の方が後ろの時刻で入る。一覧は
 * `createdAt` 順に並べるため、再読み込みしたときに秘書の返答が自分の次の発言より下へ回る。
 *
 * 同じスレッドの生成が畳まれるまで、次のリクエストをここで待たせて順序を保つ。
 * プロセス内のMapで足りるのは、PM2で1プロセスしか動かさないため（`deploy/ecosystem.config.js`）。
 * 前提が変わって複数プロセスになっても、順序が保証されなくなるだけで壊れはしない。
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
 * 保存してある発言を、Messages APIへ渡せる形に均す。
 *
 * 保存された並びは、そのままでは2つの理由でAPIの前提を外れる。
 *
 * - `HISTORY_LIMIT` で頭を切るため、窓の先頭がassistantの発言になることがある
 * - 返答の生成に失敗した往復では返答が保存されないため、userの発言が2つ続くことがある
 *
 * どちらもリクエスト全体が400で弾かれる。ここで先頭を落とし、続いた同じ役割はまとめる。
 *
 * あわせて、割り込まれた返答には注記を添える（#48）。DBの本文はそのまま画面へ出すため
 * 汚さず、モデルへ渡すときにだけ「ここで遮られた」と分かる形にする。
 */
function toPromptMessages(
  entries: { role: "USER" | "ASSISTANT"; content: string; interrupted: boolean }[],
): Anthropic.MessageParam[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];

  for (const entry of entries) {
    const role = entry.role === "USER" ? ("user" as const) : ("assistant" as const);

    if (result.length === 0 && role !== "user") continue;

    const content =
      role === "assistant" && entry.interrupted
        ? `${entry.content}\n\n${INTERRUPTED_NOTE}`
        : entry.content;

    const last = result[result.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
      continue;
    }

    result.push({ role, content });
  }

  return result;
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

  const history = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "desc" },
    take: HISTORY_LIMIT,
    select: { role: true, content: true, interrupted: true },
  });

  const promptMessages = toPromptMessages(history.reverse());

  // 音声で聞くかどうかはこの1往復ぶんの都合なので、スレッドには持たせず毎回受け取る。
  // 同じスレッドを「話す」と「書く」で行き来しても、履歴はそのまま繋がる。
  const style: ReplyStyle = body.mode === "voice" ? "voice" : "text";

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch {
    // 設定漏れをそのまま画面へ出すと原因が伝わらないため、文言をここで作る。
    console.error("[aide-bot] ANTHROPIC_API_KEY が未設定のため返答を生成できない");
    return fail("返答の生成に必要な設定がサーバー側にありません。管理者に連絡してください。", 503);
  }

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
          const messageStream = client.messages.stream(
            {
              model: CHAT_MODEL,
              max_tokens: maxOutputTokens(style),
              system: secretarySystemPrompt(style),
              messages: promptMessages,
            },
            { signal: request.signal },
          );

          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              answer += event.delta.text;
              controller.enqueue(sse("delta", { text: event.delta.text }));
            }
          }
        } catch (error) {
          // 割り込まれた場合・「止める」を押された場合・タブを閉じられた場合はここに来る。
          // 異常ではないので、そこまでの返答を保存して静かに終える。
          if (error instanceof APIUserAbortError || request.signal.aborted) {
            interrupted = true;
          } else {
            console.error("[aide-bot] 返答の生成に失敗した", error);
            errorMessage = "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
          }
        }

        // 途中で切れていても、そこまでの返答は残す。消えると何を聞いたかだけが残る。
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
