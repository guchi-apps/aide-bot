import { db } from "@/lib/db";
import { SCHEDULED_PUSH_ALL, maskToDays } from "@/lib/scheduled-push-rule";
import { daysLabel } from "@/lib/settings-proposal";
import { listTopicCategories } from "@/lib/topic-category-store";

/**
 * 相談のプロンプトへ載せる「いまの設定」の一覧（#352。ニュースの種類と定時のお知らせだけ）。
 * 変更案（`settings-change`）で既存のものを名前で指せるようにするため。**履歴の後ろに置く**
 * （最近の話題と同じ。前に置くと設定を変えるたびに履歴ぶんのキャッシュ #56 が切れる）。
 * 読めなかった回は空にして、相談は止めない。
 */
export async function currentSettingsForChat(userId: string): Promise<string> {
  try {
    const [categories, schedules] = await Promise.all([
      listTopicCategories(userId),
      db.scheduledPush.findMany({ where: { userId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    ]);

    const nameByKey = new Map(categories.map((category) => [category.id, category.label]));
    const lines = [
      `ニュースの種類: ${categories.length === 0 ? "なし" : categories.map((c) => `${c.label}（${c.enabled ? "仕入れる" : "仕入れない"}）`).join("、")}`,
      ...(schedules.length === 0
        ? ["定時のお知らせ: なし"]
        : schedules.map((row) => {
            const category =
              row.category === SCHEDULED_PUSH_ALL ? "すべての種類" : (nameByKey.get(row.category) ?? "削除された種類");
            const time = `${row.hour}:${String(row.minute).padStart(2, "0")}`;
            return `定時のお知らせ: ${daysLabel(maskToDays(row.daysMask))} ${time} ${category}（${row.enabled ? "オン" : "オフ"}）`;
          })),
    ];
    return lines.join("\n");
  } catch (error) {
    console.error("設定の一覧を読めませんでした", error);
    return "";
  }
}
