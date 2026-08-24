#!/usr/bin/env node
// 開発／CI用のダミーデータを投入する。
//
// 共有ワークフロー（issue-deckのreusable-issue-dispatch.yml）が `db:seed:ci` という
// 名前で `--if-present` 付きで呼ぶ。**スクリプト名を変えると無言でスキップされる。**
// ローカルからは `pnpm db:seed:dev`（scripts/seed-dev-db.sh）が接続先を確かめてから呼ぶ。
//
// ここで作るユーザーは、開発用ログイン（#25）で入るバイパス対象のダミーユーザー。
// supabaseUserId の値は src/lib/ci-auth-bypass.ts の CI_BYPASS_SUPABASE_USER_ID と
// **必ず一致させること**（プレーンJSのスクリプトのためTSファイルを直接importせず、
// 値をこのファイルに直書きしている）。一致していないと、ログインは通るのに
// getCurrentUser() がnullを返し、画面が /login へ戻り続ける。

import { PrismaClient } from "@prisma/client";

const CI_BYPASS_SUPABASE_USER_ID = "ci-screenshot-bot";

const db = new PrismaClient();

async function main() {
  const user = await db.user.upsert({
    where: { supabaseUserId: CI_BYPASS_SUPABASE_USER_ID },
    update: {},
    create: {
      supabaseUserId: CI_BYPASS_SUPABASE_USER_ID,
      email: "ci-screenshot-bot@example.com",
      name: "開発用ダミーユーザー",
    },
  });

  console.log(`[aide-bot] バイパス用ユーザーをupsertしました: id=${user.id} name=${user.name}`);

  // 会話履歴などのモデルが増えたら、このユーザー（user.id）に紐づくダミーデータを
  // ここへ足す。認証を抜けても画面が空のままでは検証にならないため、画面に出る
  // モデルを追加したIssueが、同じPRでここへの投入も入れること。
  // いまはスキーマにUserしか無いため、投入するのはユーザー1件だけ。
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
