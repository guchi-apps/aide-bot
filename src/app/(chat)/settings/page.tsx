import { redirect } from "next/navigation";

import { ConnectionList } from "@/components/settings/connection-list";
import { getCurrentUser } from "@/lib/auth-user";
import { listConnections } from "@/lib/mcp/connections";

export const metadata = { title: "接続" };

// 接続の状態は認可から戻った直後に変わる。キャッシュさせない。
export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ error?: string; connected?: string }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [connections, query] = await Promise.all([listConnections(user.id), searchParams]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ConnectionList connections={connections} error={query.error} connected={query.connected} />
    </div>
  );
}
