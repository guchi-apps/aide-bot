import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { applyMemoryAction, type MemoryAction } from "@/lib/memory";
import { checkNotionStates, recordWishToNotion } from "@/lib/memory-extract";
import { db } from "@/lib/db";

/**
 * 継続記憶（#323）への操作。残す（confirm）・見送る（dismiss）・忘れる（forget）・直す（edit）と、
 * Notionの確認（notion_check）・Notionへの記録（notion_record）。
 *
 * `/api/*` はmiddlewareが素通しするので、ログイン判定はここで行う。**操作は必ず本人の記憶に対してだけ**
 * （`applyMemoryAction()` が `userId` との組で引く）。
 */

export const dynamic = "force-dynamic";
/** Notionの検索で道具を数回呼ぶ。 */
export const maxDuration = 180;

const ACTIONS = new Set<string>(["confirm", "dismiss", "forget", "edit"]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const { id } = await params;
  const action = body.action;

  if (ACTIONS.has(action)) {
    const content = typeof body.content === "string" ? body.content : undefined;
    const result = await applyMemoryAction(user.id, id, action as MemoryAction, content);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true });
  }

  if (action === "notion_check" || action === "notion_record") {
    try {
      if (action === "notion_check") {
        const memory = await db.memory.findFirst({
          where: { id, userId: user.id, kind: "WISH", status: "CONFIRMED" },
          select: { id: true, content: true },
        });
        if (!memory) return NextResponse.json({ error: "対象の記憶が見つかりません。" }, { status: 404 });

        const states = await checkNotionStates(user.id, [memory]);
        const state = states.get(memory.id);
        return NextResponse.json(
          state
            ? { ok: true, notion: state }
            : { ok: false, error: "Notionの状態を読み取れませんでした。確認できていません。" },
        );
      }

      return NextResponse.json({ ok: true, ...(await recordWishToNotion(user.id, id)) });
    } catch (error) {
      console.error("[aide-bot] 継続記憶のNotion操作に失敗した", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Notionの操作に失敗しました。" },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ error: "知らない操作です。" }, { status: 400 });
}
