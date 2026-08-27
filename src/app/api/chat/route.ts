import type Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import {
  INTERRUPTED_NOTE,
  MCP_BETA,
  getAnthropicClient,
  historyWindowSkip,
  maxOutputTokens,
  secretarySystemPrompt,
  type ReplyStyle,
} from "@/lib/anthropic";
import { getCurrentUser } from "@/lib/auth-user";
import { selectedChatModels } from "@/lib/chat-model-server";
import { MAX_MESSAGE_LENGTH, buildConversationTitle } from "@/lib/conversation";
import { db } from "@/lib/db";
import {
  listConnectedServers,
  toMcpRequestParts,
  type ConnectedServer,
} from "@/lib/mcp/connections";
import { writeToolsFor } from "@/lib/mcp/presets";
import { writeToolsAllowed } from "@/lib/mcp/write-tools";
import { selectedWriteToolPolicy } from "@/lib/mcp/write-tools-server";
import {
  TOOL_CALL_INPUT_LIMIT,
  TOOL_CALL_OUTPUT_LIMIT,
  truncateToolText,
} from "@/lib/tool-call";

/**
 * 1回の送信で回すモデルとのやり取りの上限（#46）。
 *
 * MCPのツール実行はAnthropic側で完結するため、通常は1回で返答まで終わる。ただし
 * 長く掛かった回は `pause_turn` で一旦返ってくるので、そこまでの内容を渡して続きを頼む。
 * 上限が無いと、止まらない回に付き合い続けることになる。
 */
const MAX_TURNS = 4;

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
 * 1回の生成で使ったトークン数（#51）。`ApiUsage` の1行として残し、使用量の画面が足し上げる。
 *
 * 返答（`Message`）とは別の行にするのは、**返答が保存されない往復があるため**。1文字も出ない
 * うちに割り込まれた場合も生成に失敗した場合も、入力ぶんはその時点で使い終わっている。
 */
type GenerationUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

/**
 * 書き込みの道具を1回呼んだ記録（#81）。`ToolCall` の1行として残す。
 *
 * 残すのは**書き込みだと把握している道具**（`MCP_PRESETS` の `writeTools`）だけ。取得系まで
 * 残すと、相談のたびに数行ずつ増えて肝心の書き込みが埋もれる。**挙げ漏らした道具は絞り込みと
 * 同じくここにも残らない**ので、「記録に無い＝書き込んでいない」とは読めない（#78）。
 */
type WriteToolCall = {
  /** `mcp_tool_use` のID。結果（`mcp_tool_result`）と突き合わせるために持つ。 */
  toolUseId: string;
  serverSlug: string;
  serverLabel: string;
  toolName: string;
  /** `input_json_delta` を継ぎ足したもの。届かなかった場合は `fallbackInput` を使う。 */
  input: string;
  /** `content_block_start` に載っていた引数。刻まれずに一度で届く場合の受け皿。 */
  fallbackInput: string;
  output: string | null;
  failed: boolean;
  /**
   * 呼んだ時刻。
   *
   * 行を作るのは返答を保存した後なので、`createdAt` を既定のnow()に任せると、相談の画面で
   * 秘書の返答より後ろに並ぶ。呼んだ時点の時刻をここで押さえ、そのまま列へ入れる。
   */
  occurredAt: Date;
};

/** 画面へ流す形（`ChatToolCall`）。DBの行と同じ内容を、保存を待たずに送る。 */
function toRecordEvent(call: WriteToolCall) {
  return {
    id: call.toolUseId,
    server: call.serverLabel,
    tool: call.toolName,
    input: toolCallInput(call),
    output: call.output,
    failed: call.failed,
  };
}

/** 保存・表示に使う引数。刻まれて届いたぶんを優先し、無ければ最初に載っていたぶんを使う。 */
function toolCallInput(call: WriteToolCall): string {
  return truncateToolText(call.input !== "" ? call.input : call.fallbackInput, TOOL_CALL_INPUT_LIMIT);
}

/** `mcp_tool_result` の中身を、そのまま残せる文字列に均す。 */
function toolResultText(content: string | { type: "text"; text: string }[]): string {
  if (typeof content === "string") return content;
  return content.map((block) => block.text).join("\n");
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
 * プロンプトキャッシュのブレークポイントを何個置くか（#56）。
 *
 * 1つは**今回書き込む位置**、もう1つは**前回書き込んだ位置**に置く。前者だけだと、書いた
 * キャッシュを次の往復が読む前に、その往復がさらに先の位置へ書き直すことになり、読み出しは
 * 常に1往復ぶん手前で止まる。2つ置くと、前回ぶんを読みながら今回ぶんを書ける。
 *
 * APIが受け付けるのは1リクエストにつき4つまで。
 */
const CACHE_BREAKPOINTS = 2;

/** キャッシュの保持時間は既定（5分）のまま。相談の往復はそれより短い間隔で続く。 */
const CACHE_CONTROL = { type: "ephemeral" } as const;

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
 *
 * **本文は常に `[{ type: "text" }]` の配列で渡す**（#56）。キャッシュのブレークポイントは
 * 内容ブロックにしか置けず、文字列とブロック配列を往復ごとに使い分けると、同じ発言なのに
 * 送っている形だけが変わる。前方一致が崩れる余地を残さないよう、印の有無によらず形を揃える。
 */
function toPromptMessages(
  entries: { role: "USER" | "ASSISTANT"; content: string; interrupted: boolean }[],
): Anthropic.Beta.BetaMessageParam[] {
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

  const breakpoints = cacheBreakpointIndexes(merged);

  return merged.map((message, index) => ({
    role: message.role,
    content: [
      {
        type: "text" as const,
        text: message.content,
        ...(breakpoints.has(index) ? { cache_control: CACHE_CONTROL } : {}),
      },
    ],
  }));
}

/**
 * キャッシュのブレークポイントを置く位置を決める（#56）。
 *
 * **今回の発言を除いた、新しい方から `CACHE_BREAKPOINTS` 個のassistantの返答**に置く。
 * 秘書の返答は往復の区切りなので、次の往復でも同じ返答が同じ位置に現れる——つまり
 * 「今回ここへ書いたキャッシュ」を「次回はここから読む」形になり、往復のたびに読み位置が
 * 1つずつ後ろへ進む。
 *
 * 今回の発言（末尾）には置かない。毎回変わるため、書いても二度と読まれない。
 */
function cacheBreakpointIndexes(messages: { role: "user" | "assistant" }[]): Set<number> {
  const indexes = new Set<number>();

  for (let index = messages.length - 2; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") continue;

    indexes.add(index);
    if (indexes.size >= CACHE_BREAKPOINTS) break;
  }

  return indexes;
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

  // 窓の先頭は `HISTORY_WINDOW_STEP` の刻みでしか動かさない（#56）。1発言ずつ滑らせると
  // 往復のたびにプレフィックスの先頭が変わり、プロンプトキャッシュが一度も効かなくなる。
  const messageCount = await db.message.count({ where: { conversationId: conversation.id } });

  const history = await db.message.findMany({
    where: { conversationId: conversation.id },
    // 並びが揺れればプレフィックスも揺れる。`createdAt` が同じ発言があっても毎回同じ順で
    // 並ぶよう、第2のキーにidを置く。
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: historyWindowSkip(messageCount),
    select: { role: true, content: true, interrupted: true },
  });

  const promptMessages = toPromptMessages(history);

  // 音声で聞くかどうかはこの1往復ぶんの都合なので、スレッドには持たせず毎回受け取る。
  // 同じスレッドを「話す」と「書く」で行き来しても、履歴はそのまま繋がる。
  const style: ReplyStyle = body.mode === "voice" ? "voice" : "text";

  // 返答に使うモデルは、この端末が設定の画面で選んだもの（#71）。話すときと書くときで
  // 別々に持てる。**リクエストの本文ではなくCookieから読む**——利用者が書き換えられる
  // 値であることは変わらないが、`normalizeChatModel()` が知らない値を既定へ落とすため、
  // 存在しないモデル名がそのままAPIへ渡ることはない。
  const model = (await selectedChatModels())[style];

  // 繋いでいる外部サービス（#46）。読み出しに失敗しても相談そのものは通す。
  // 繋がっていないぶんは答えられないだけで、送信ごと弾くより実害が小さい。
  let servers: ConnectedServer[] = [];
  try {
    servers = await listConnectedServers(user.id);
  } catch (error) {
    console.error("[aide-bot] 接続の読み出しに失敗した", error);
  }

  // 書き込みの道具を渡すかどうか（#78）。既定は渡さない。モデルの選択と同じくCookieに
  // 持たせてあり、知らない値は「渡さない」へ落ちる。
  const allowWriteTools = writeToolsAllowed(await selectedWriteToolPolicy(), style);

  const { mcpServers, tools, withheldTools } = toMcpRequestParts(servers, allowWriteTools);
  // ツール実行を画面へ出すとき、利用者に見せるのはslugではなく付けた名前。
  const labelBySlug = new Map(servers.map((server) => [server.slug, server.label]));
  // 記録に残す対象（#81）。絞り込みと同じ名前の表を引く——止める側と残す側で表が分かれると、
  // 片方だけに足したときに「渡っているのに記録されない」道具ができる。
  const writeToolsBySlug = new Map(
    servers.map((server) => [server.slug, new Set(writeToolsFor(server.url))]),
  );

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
        // このリクエストで使ったトークン数（#51）。数える単位は「API呼び出し1回」なので、
        // `pause_turn` で続きを頼み直した往復ではここに複数並ぶ。
        const usages: GenerationUsage[] = [];
        // いま流れている呼び出しぶん。`usages` へ載せた実体をそのまま書き換える。
        let usage: GenerationUsage | null = null;
        // この往復で呼ばれた書き込みの道具（#81）。`ToolCall` へ残し、画面へも流す。
        const writeCalls: WriteToolCall[] = [];
        // 引数は `input_json_delta` で刻まれて届く。内容ブロックの番号で突き合わせる
        // （番号は1メッセージの中でしか通じないので `message_start` で捨てる）。
        const writeCallByIndex = new Map<number, WriteToolCall>();
        // 結果は `tool_use` のIDで返ってくる。こちらはメッセージをまたいでも変わらない。
        const writeCallByUseId = new Map<string, WriteToolCall>();

        try {
          // `pause_turn` で戻ってきたときは、そこまでの内容を足して続きを頼む（#46）。
          const turns: Anthropic.Beta.BetaMessageParam[] = [...promptMessages];

          for (let turn = 0; turn < MAX_TURNS; turn += 1) {
            const messageStream = client.beta.messages.stream(
              {
                // 繋いでいないときはベータもツールも渡さない（#46）。従来どおりのリクエストに戻す。
                ...(mcpServers.length > 0
                  ? { betas: [MCP_BETA], mcp_servers: mcpServers, tools }
                  : {}),
                model,
                max_tokens: maxOutputTokens(style, mcpServers.length > 0),
                // システムプロンプトにはブレークポイントを置かない（#56）。単体では
                // キャッシュできる最小の長さに届かず、置いても黙って無視されるだけ。履歴側の
                // ブレークポイントがここを含む前半まとめてをキャッシュするので、往復が続けば
                // システムプロンプトも一緒に乗る。
                system: secretarySystemPrompt(
                  style,
                  servers.map((server) => server.label),
                  withheldTools.length > 0,
                ),
                messages: turns,
              },
              { signal: request.signal },
            );

            for await (const event of messageStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
                answer += event.delta.text;
                controller.enqueue(sse("delta", { text: event.delta.text }));
                continue;
              }

              // 外部サービスを見に行った時点で画面へ知らせる（#46）。
              // 何も出ないまま数秒黙るのを防ぐ。
              if (event.type === "content_block_start" && event.content_block.type === "mcp_tool_use") {
                const block = event.content_block;
                const serverLabel = labelBySlug.get(block.server_name) ?? block.server_name;
                controller.enqueue(sse("tool", { server: serverLabel, tool: block.name }));

                // 書き込みの道具だけ、あとから辿れるよう控えておく（#81）。
                if (writeToolsBySlug.get(block.server_name)?.has(block.name)) {
                  const call: WriteToolCall = {
                    toolUseId: block.id,
                    serverSlug: block.server_name,
                    serverLabel,
                    toolName: block.name,
                    input: "",
                    fallbackInput: JSON.stringify(block.input ?? {}),
                    output: null,
                    failed: false,
                    occurredAt: new Date(),
                  };
                  writeCalls.push(call);
                  writeCallByIndex.set(event.index, call);
                  writeCallByUseId.set(block.id, call);
                }
                continue;
              }

              // 引数は刻まれて届く。ここで拾わないと、記録に残るのは道具の名前だけになる（#81）。
              if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
                const call = writeCallByIndex.get(event.index);
                if (call) call.input += event.delta.partial_json;
                continue;
              }

              // 結果が返ったところで画面へ流す（#81）。ここまで来れば「実際に外へ出た」ことが
              // 確定しているので、生成中の一瞬の表示ではなく残る記録として扱える。
              if (
                event.type === "content_block_start" &&
                event.content_block.type === "mcp_tool_result"
              ) {
                const block = event.content_block;
                const call = writeCallByUseId.get(block.tool_use_id);
                if (call) {
                  call.failed = block.is_error;
                  call.output = truncateToolText(
                    toolResultText(block.content),
                    TOOL_CALL_OUTPUT_LIMIT,
                  );
                  controller.enqueue(sse("record", toRecordEvent(call)));
                }
                continue;
              }

              // トークン数は最初と最後のイベントに乗ってくる（#51）。
              // `message_start` は入力ぶんが確定した時点、`message_delta` はそこまでの累計で、
              // 生成が終わるまで何度か届く。後から来た値で上書きする。
              //
              // **`message_start` を受けた時点で `usages` へ載せる。** 途中で遮られると
              // `message_delta` は届かないが、入力ぶんはその時点でもう使い終わっている。
              if (event.type === "message_start") {
                // 内容ブロックの番号は1メッセージの中でしか通じない（#81）。`pause_turn` で
                // 頼み直した続きでは0から振り直されるため、ここで捨てないと前のメッセージの
                // 呼び出しへ引数を継ぎ足してしまう。
                writeCallByIndex.clear();
                usage = {
                  model: event.message.model,
                  inputTokens: event.message.usage.input_tokens,
                  outputTokens: event.message.usage.output_tokens,
                  cacheWriteTokens: event.message.usage.cache_creation_input_tokens ?? 0,
                  cacheReadTokens: event.message.usage.cache_read_input_tokens ?? 0,
                };
                usages.push(usage);
                continue;
              }

              if (event.type === "message_delta" && usage) {
                usage.inputTokens = event.usage.input_tokens ?? usage.inputTokens;
                usage.outputTokens = event.usage.output_tokens;
                usage.cacheWriteTokens =
                  event.usage.cache_creation_input_tokens ?? usage.cacheWriteTokens;
                usage.cacheReadTokens = event.usage.cache_read_input_tokens ?? usage.cacheReadTokens;
              }
            }

            const final = await messageStream.finalMessage();
            if (final.stop_reason !== "pause_turn") break;

            turns.push({ role: "assistant", content: final.content });
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

        // 使ったぶんは、返答が残ったかどうかによらず記録する（#51）。
        // 遮られて1文字も出なかった往復でも、入力ぶんはもう使い終わっている。
        // 途中で遮られると `message_delta` が届かず、出力ぶんは `message_start` 時点の値
        // （数トークン）のまま残る。埋め合わせの推定はせず、少なめの実測値をそのまま入れる。
        //
        // `pause_turn` で続きを頼み直した往復（#46）はAPIを複数回叩いているので、行も
        // その回数ぶんできる。1回ごとに数えるのが#51で決めた単位で、まとめない。
        for (const entry of usages) {
          try {
            await db.apiUsage.create({
              data: {
                userId: user.id,
                conversationId: conversation.id,
                model: entry.model,
                inputTokens: entry.inputTokens,
                outputTokens: entry.outputTokens,
                cacheWriteTokens: entry.cacheWriteTokens,
                cacheReadTokens: entry.cacheReadTokens,
              },
            });
          } catch (error) {
            // 記録できなくても相談は続けられる。画面へは出さず、ログにだけ残す。
            console.error("[aide-bot] 使用量の記録に失敗した", error);
          }
        }

        // 書き込みの道具を呼んだ記録（#81）。`ApiUsage` と同じく、**失敗しても相談は止めない**
        // ——記録できないことより、返答が返らないことの方が重い。
        //
        // 返答を保存した後に書いているが、並びは崩れない。`createdAt` には呼んだ時点の時刻を
        // 明示的に入れてあり、画面はその時刻で発言と混ぜて並べる。
        for (const call of writeCalls) {
          try {
            await db.toolCall.create({
              data: {
                userId: user.id,
                conversationId: conversation.id,
                serverLabel: call.serverLabel,
                serverSlug: call.serverSlug,
                toolName: call.toolName,
                input: toolCallInput(call),
                output: call.output,
                failed: call.failed,
                createdAt: call.occurredAt,
              },
            });
          } catch (error) {
            console.error("[aide-bot] 書き込みの記録に失敗した", error);
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
