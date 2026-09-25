import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth-user";
import { readJsonObject } from "@/lib/json-body";
import { applySettingsChanges } from "@/lib/settings-apply";
import { MAX_CHANGES, validateChange, type SettingsChange } from "@/lib/settings-proposal";

/**
 * 秘書が出した設定の変更案を、利用者が「変更する」を押して反映する入口（#346）。
 * 案は本文にあるだけで信用しない——ここでもう一度検証してから書く。
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }

  const body = await readJsonObject(request);
  if (!body || !Array.isArray(body.changes) || body.changes.length === 0 || body.changes.length > MAX_CHANGES) {
    return NextResponse.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const changes: SettingsChange[] = [];
  for (const raw of body.changes) {
    const change = validateChange(raw);
    if (!change) {
      return NextResponse.json({ error: "変更の内容が正しくありません。" }, { status: 400 });
    }
    changes.push(change);
  }

  await applySettingsChanges(user.id, changes);
  return NextResponse.json({ ok: true });
}
