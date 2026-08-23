// Prisma CLI（migrate/generate/studio）はNext.jsと違い `.env.local` を自動で読まず、
// `.env` しか読まない。`prisma migrate dev` 等が `next dev` と同じDATABASE_URLを
// 見るように、ここで明示的に読み込む。
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
});
