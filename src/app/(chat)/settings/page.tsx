import { redirect } from "next/navigation";

import { BriefingTimePicker } from "@/components/settings/briefing-time-picker";
import { ConnectionList } from "@/components/settings/connection-list";
import { HomeProfileCard } from "@/components/settings/home-profile-card";
import { ProactiveSettingsCard } from "@/components/settings/proactive-settings";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { ScheduledPushSettingsCard } from "@/components/settings/scheduled-push-settings";
import { WakeTriggerCard } from "@/components/settings/wake-trigger-card";
import { WriteToolPicker } from "@/components/settings/write-tool-picker";
import { getCurrentUser } from "@/lib/auth-user";
import { listConnections } from "@/lib/mcp/connections";
import { writeToolsFor } from "@/lib/mcp/presets";
import { selectedWriteToolPolicy } from "@/lib/mcp/write-tools-server";
import { hasNotionConnection } from "@/lib/home-profile";
import { pushPublicKey } from "@/lib/push/config";
import { normalizeFrequency } from "@/lib/proactive-labels";
import { countSubscriptions } from "@/lib/push/subscriptions";
import { db } from "@/lib/db";

export const metadata = { title: "設定" };

// 接続の状態は認可から戻った直後に変わるのでキャッシュさせない。
export const dynamic = "force-dynamic";

/**
 * 時刻を日本時間の「9月14日 07:02」の形にする。
 *
 * サーバー側で整形して渡す（クライアントで作ると端末のタイムゾーンで出て、ハイドレーションでもずれる）。
 */
function jstDateTimeLabel(at: Date | null): string | null {
  if (!at) return null;

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}

type Props = {
  searchParams: Promise<{ error?: string; connected?: string }>;
};

export default async function SettingsPage({ searchParams }: Props) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const [connections, query, writeToolPolicy, deviceCount, scheduledPushes] = await Promise.all([
    listConnections(user.id),
    searchParams,
    selectedWriteToolPolicy(),
    countSubscriptions(user.id),
    db.scheduledPush.findMany({
      where: { userId: user.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, daysMask: true, hour: true, minute: true, category: true, enabled: true },
    }),
  ]);

  // 繋いでいる接続すべてを並べる（#78）。いま相談へ渡っているのは「使用中」のものだけだが、
  // 休止中のものも使うようにした時点で同じ扱いになるため、状態を添えて全部出す。
  const writeToolTargets = connections.map((connection) => ({
    label: connection.label,
    tools: writeToolsFor(connection.url),
    inUse: connection.connected && connection.enabled,
  }));

  // 自宅の情報（#167）。取り込んだ時刻はサーバー側で日本時間へ整形して渡す
  // （クライアントで作ると端末のタイムゾーンで出て、ハイドレーションでもずれる）。
  const homeProfileFetchedAt = jstDateTimeLabel(user.homeProfileFetchedAt);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 md:px-7">
        <header>
          <h2 className="text-lg font-medium">設定</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            秘書からのお知らせ、自宅の情報、外部サービスとの接続、書き込みの道具の
            扱いをここで変えられます。
          </p>
        </header>

        {/* VAPIDの公開鍵はここでpropsとして渡す（#79）。`NEXT_PUBLIC_*` に置くとビルド時に
            バンドルへ焼き込まれ、鍵を差し替えるたびに再ビルドが要る。理由の詳細は
            `@/lib/push/config` のコメント。 */}
        <NotificationSettings publicKey={pushPublicKey()} initialDeviceCount={deviceCount} />

        <ProactiveSettingsCard
          hasDevice={deviceCount > 0}
          initial={{
            weekend: user.proactiveWeekend,
            freeTime: user.proactiveFreeTime,
            ongoing: user.proactiveOngoing,
            quietStart: user.proactiveQuietStart,
            quietEnd: user.proactiveQuietEnd,
            avoidWork: user.proactiveAvoidWork,
            frequency: normalizeFrequency(user.proactiveFrequency),
          }}
        />

        <ScheduledPushSettingsCard initial={scheduledPushes} hasDevice={deviceCount > 0} />

        <BriefingTimePicker initial={{ hour: user.briefingHour, minute: user.briefingMinute }} />

        {/* 起きた合図（#233）。トークンの本体はDBに無いので、発行済みかどうかは時刻で渡す。 */}
        <WakeTriggerCard
          issuedAtLabel={user.wakeTokenHash ? jstDateTimeLabel(user.wakeTokenCreatedAt) : null}
          usedAtLabel={user.wakeTokenHash ? jstDateTimeLabel(user.wakeTokenUsedAt) : null}
        />

        <HomeProfileCard
          initialProfile={user.homeProfile}
          fetchedAtLabel={homeProfileFetchedAt}
          notionConnected={hasNotionConnection(
            connections.filter((connection) => connection.connected).map((connection) => connection.url),
          )}
        />

        <ConnectionList connections={connections} error={query.error} connected={query.connected} />

        <WriteToolPicker initial={writeToolPolicy} targets={writeToolTargets} />
      </div>
    </div>
  );
}
