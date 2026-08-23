import type { Metadata } from "next";

import { safeInternalPath } from "@/lib/safe-path";

export const metadata: Metadata = {
  title: "ログイン | 秘書アプリ",
};

const errorMessages: Record<string, string> = {
  auth_failed: "ログインに失敗しました。もう一度お試しください。",
  not_allowed: "このGoogleアカウントは利用を許可されていません。",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : null;
  const callbackUrl = typeof params.callbackUrl === "string" ? params.callbackUrl : null;
  const next = safeInternalPath(callbackUrl, "/");

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-sm">
        <h1 className="text-xl font-semibold">秘書アプリ</h1>
        <p className="mt-2 text-sm text-muted">
          NotionやAIDEを参照して、あなたのプライベートを補佐します。
        </p>

        {errorKey && (
          <p
            role="alert"
            className="mt-6 rounded-lg border border-border bg-background px-4 py-3 text-sm"
          >
            {errorMessages[errorKey] ?? "ログインできませんでした。"}
          </p>
        )}

        {/* ハイドレーション前でも押せるよう、素のリンクでサーバー側の導線へ渡す。 */}
        <a
          href={`/auth/signin?next=${encodeURIComponent(next)}`}
          className="mt-8 flex h-12 w-full items-center justify-center rounded-lg bg-accent font-medium text-white transition-opacity hover:opacity-90"
        >
          Googleでログイン
        </a>

        <p className="mt-4 text-xs text-muted">許可されたGoogleアカウントのみ利用できます。</p>
      </div>
    </main>
  );
}
