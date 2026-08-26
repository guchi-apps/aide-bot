import { redirect } from "next/navigation";

import { ConnectionList } from "@/components/settings/connection-list";
import { ModelPicker } from "@/components/settings/model-picker";
import { WriteToolPicker } from "@/components/settings/write-tool-picker";
import { getCurrentUser } from "@/lib/auth-user";
import { selectedChatModels } from "@/lib/chat-model-server";
import { listConnections } from "@/lib/mcp/connections";
import { writeToolsFor } from "@/lib/mcp/presets";
import { selectedWriteToolPolicy } from "@/lib/mcp/write-tools-server";

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

  const [connections, query, models, writeToolPolicy] = await Promise.all([
    listConnections(user.id),
    searchParams,
    selectedChatModels(),
    selectedWriteToolPolicy(),
  ]);

  // 繋いでいる接続すべてを並べる（#78）。いま相談へ渡っているのは「使用中」のものだけだが、
  // 休止中のものも使うようにした時点で同じ扱いになるため、状態を添えて全部出す。
  const writeToolTargets = connections.map((connection) => ({
    label: connection.label,
    tools: writeToolsFor(connection.url),
    inUse: connection.connected && connection.enabled,
  }));

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-7">
        <header>
          <h2 className="text-lg font-medium">設定</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            返答に使うモデルと、外部サービスとの接続、書き込みの道具の扱いをここで変えられます。
          </p>
        </header>

        <ModelPicker initial={models} />

        <ConnectionList connections={connections} error={query.error} connected={query.connected} />

        <WriteToolPicker initial={writeToolPolicy} targets={writeToolTargets} />
      </div>
    </div>
  );
}
