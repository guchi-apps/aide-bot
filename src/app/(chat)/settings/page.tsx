import { redirect } from "next/navigation";

import { ConnectionList } from "@/components/settings/connection-list";
import { ModelPicker } from "@/components/settings/model-picker";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { getCurrentUser } from "@/lib/auth-user";
import { selectedChatModels } from "@/lib/chat-model-server";
import { listConnections } from "@/lib/mcp/connections";
import { pushPublicKey } from "@/lib/push/config";
import { countSubscriptions } from "@/lib/push/subscriptions";

export const metadata = { title: "設定" };

// 接続の状態は認可から戻った直後に変わる。選んでいるモデルもCookie次第なのでキャッシュさせない。
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ error?: string; connected?: string }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [connections, query, models, deviceCount] = await Promise.all([
    listConnections(user.id),
    searchParams,
    selectedChatModels(),
    countSubscriptions(user.id),
  ]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-7">
        <header>
          <h2 className="text-lg font-medium">設定</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            秘書からのお知らせ、返答に使うモデル、外部サービスとの接続をここで変えられます。
          </p>
        </header>

        {/* VAPIDの公開鍵はここでpropsとして渡す（#79）。`NEXT_PUBLIC_*` に置くとビルド時に
            バンドルへ焼き込まれ、鍵を差し替えるたびに再ビルドが要る。理由の詳細は
            `@/lib/push/config` のコメント。 */}
        <NotificationSettings publicKey={pushPublicKey()} initialDeviceCount={deviceCount} />

        <ModelPicker initial={models} />

        <ConnectionList connections={connections} error={query.error} connected={query.connected} />
      </div>
    </div>
  );
}
