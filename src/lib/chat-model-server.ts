import { db } from "@/lib/db";
import { resolveModelSettings, type ChatModelId, type ModelUse } from "@/lib/chat-model";

/**
 * 利用者が用途ごとに選んだモデルを読む（#349）。
 *
 * **サーバー専用。** 保存先は `User.modelSettings`（Cookieにしないのは、cronや返答後の後始末など
 * Cookieの届かない経路でも同じ値を読むため）。読めなかった回は既定へ落として生成を止めない。
 */
export async function modelSettingsFor(userId: string): Promise<Record<ModelUse, ChatModelId>> {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { modelSettings: true } });
    return resolveModelSettings(user?.modelSettings);
  } catch (error) {
    console.error("モデル設定を読めなかったので既定を使います", error);
    return resolveModelSettings(null);
  }
}

export async function modelFor(userId: string, use: ModelUse): Promise<ChatModelId> {
  return (await modelSettingsFor(userId))[use];
}
