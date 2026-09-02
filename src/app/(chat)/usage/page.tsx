import { redirect } from "next/navigation";

import { UsageView } from "@/components/chat/usage-view";
import { getCurrentUser } from "@/lib/auth-user";
import { selectedChatModels } from "@/lib/chat-model-server";
import { dailyUsage, startOfDay, startOfMonth, usageBreakdown } from "@/lib/usage";

/** グラフに並べる日数。スマホの幅（393px）でも棒が潰れない範囲に収める。 */
const CHART_DAYS = 14;
/** 表に出す日数。数字を読むのは直近の数日なので、グラフより短くする。 */
const TABLE_DAYS = 7;

// 相談するたびに変わる数字なので、ビルド時の値を配らない。
export const dynamic = "force-dynamic";

export const metadata = { title: "使用量" };

/**
 * APIの消費量（#51・#133）。ログイン中の本人ぶんだけを集計して出す。
 *
 * 課金の形（Codexの定額／Claudeの従量）で割った形でしか渡さない。画面側で足し直すと、
 * 定額のはずの経路に費用が付いて見える。
 */
export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const now = new Date();

  const [today, month, total, daily, models] = await Promise.all([
    usageBreakdown({ userId: user.id, since: startOfDay(now) }),
    usageBreakdown({ userId: user.id, since: startOfMonth(now) }),
    usageBreakdown({ userId: user.id }),
    dailyUsage(user.id, CHART_DAYS, now),
    selectedChatModels(),
  ]);

  return (
    <UsageView
      today={today}
      month={month}
      total={total}
      daily={daily}
      tableDays={TABLE_DAYS}
      monthLabel={`${now.getMonth() + 1}月`}
      chatModels={[
        { label: "話す", model: models.voice },
        { label: "書く", model: models.text },
      ]}
    />
  );
}
