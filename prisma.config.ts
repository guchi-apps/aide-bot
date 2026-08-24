// Prisma CLI（migrate/generate/studio）はNext.jsと違い `.env.local` を自動で読まず、
// `.env` しか読まない。`prisma migrate dev` 等が `next dev` と同じDATABASE_URLを
// 見るように、ここで明示的に読み込む。
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// `quiet: true` は必須。dotenv v17は読み込み時の案内文を**stdout**へ出すが、
// Prismaはこの設定ファイルを読んだうえで `migrate dev` / `migrate diff --script` の
// SQLを同じstdoutへ書き出すため、案内文がそのままmigration.sqlの1行目に混入する。
// 実際に 20260823000000_init がそうなり、本番の `prisma migrate deploy` が
// MariaDBの構文エラー（1064）で落ちた（#9）。
loadEnv({ path: ".env.local", quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
