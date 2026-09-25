import { db } from "@/lib/db";
import type { SettingsChange } from "@/lib/settings-proposal";

/**
 * 検証済みの設定変更をDBへ反映する（#346）。**呼ぶのは利用者が「変更する」を押した入口だけ**。
 * 書く列は設定の画面と同じ（`briefingHour` など。`api/settings/briefing-time`・`api/settings/proactive`）。
 */
export async function applySettingsChanges(userId: string, changes: SettingsChange[]): Promise<void> {
  const data: Record<string, number | boolean | string> = {};

  for (const change of changes) {
    if (change.key === "briefing_time") {
      data.briefingHour = change.hour;
      data.briefingMinute = change.minute;
      continue;
    }
    if (change.weekend !== undefined) data.proactiveWeekend = change.weekend;
    if (change.freeTime !== undefined) data.proactiveFreeTime = change.freeTime;
    if (change.ongoing !== undefined) data.proactiveOngoing = change.ongoing;
    if (change.avoidWork !== undefined) data.proactiveAvoidWork = change.avoidWork;
    if (change.quietStart !== undefined) data.proactiveQuietStart = change.quietStart;
    if (change.quietEnd !== undefined) data.proactiveQuietEnd = change.quietEnd;
    if (change.frequency !== undefined) data.proactiveFrequency = change.frequency;
  }

  if (Object.keys(data).length === 0) return;
  await db.user.update({ where: { id: userId }, data });
}
