import { NextResponse } from "next/server";

import { buildAiUsageReport } from "@/lib/ai-usage-report";
import { hasValidBearer } from "@/lib/bearer-auth";
import { aiUsageGroups } from "@/lib/usage";

/**
 * このアプリのAI利用を、ops-dashboardの「アプリ別のAI利用」へ返す（#297）。
 *
 * **ops-dashboardのサーバーが読みにくる口。** ログイン判定は挟まない（呼び出し元にCookieも
 * Supabaseのセッションも無い）。代わりに `Authorization: Bearer <OPS_API_TOKEN>` で守る。
 * 値の正はops-dashboard側の `OPS_API_TOKEN` で、ほかのアプリの読み取り口と同じ検証。
 *
 * **`OPS_API_TOKEN` が未設定なら、この経路ごと401で閉じる。** 未設定と値の違いは区別して
 * 返さない（`/api/briefing` と同じ。外から設定状況を探れないようにする）。
 *
 * 返すのは回数とトークン数だけ。プロンプト本文・返答・利用者の情報は含めない。
 * 応答の形と、その意味（`inputTokens` はキャッシュ外だけ）は `@/lib/ai-usage-report`。
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  if (!hasValidBearer(request.headers.get("authorization"), process.env.OPS_API_TOKEN)) {
    return NextResponse.json({ error: "認証が必要です。" }, { status: 401, headers: NO_STORE });
  }

  try {
    const groups = await aiUsageGroups(new Date());
    // 呼び出しが無い期間は `features: []`。エラーにしない（向こうは「取得できたが0件」と読む）。
    return NextResponse.json(buildAiUsageReport(groups), { headers: NO_STORE });
  } catch (error) {
    console.error("[aide-bot] AI利用の集計に失敗した", error);
    return NextResponse.json(
      { error: "使用量を取得できませんでした。" },
      { status: 500, headers: NO_STORE },
    );
  }
}
