import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth-user";

export default async function HomePage() {
  const user = await getCurrentUser();

  // proxy.ts が未ログインを弾くため通常ここには来ないが、Supabaseのセッションはあるのに
  // aide-bot側のユーザーが未作成（DBの入れ替え等）の場合に備えてログインへ戻す。
  if (!user) {
    redirect("/login");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">秘書アプリ</h1>
          <p className="mt-1 text-sm text-muted">{user.name ?? user.email ?? "ログイン中"}</p>
        </div>

        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-surface"
          >
            ログアウト
          </button>
        </form>
      </header>

      <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="text-base font-medium">準備中</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          チャットでの相談・NotionやAIDEの参照はこれから実装します。
          いまはログインとデータベース接続までが動いています。
        </p>
      </section>
    </main>
  );
}
