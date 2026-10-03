import { db } from "@/lib/db";
import { parseDisabledKinds, type PushKind } from "@/lib/push/kinds";

/**
 * 通知の種類ごとのオフ（#488）を読む。**サーバー専用。**
 *
 * 読めなかった回は「全部オン」へ倒す——設定が読めないことで、届くはずの通知が黙って止まるよりよい。
 */
export async function disabledPushKinds(userId: string): Promise<Set<PushKind>> {
  try {
    const row = await db.user.findUnique({ where: { id: userId }, select: { pushDisabledKinds: true } });
    return parseDisabledKinds(row?.pushDisabledKinds);
  } catch (error) {
    console.error("[aide-bot] 通知の種類の設定を読めなかった", error);
    return new Set();
  }
}

export async function isPushKindEnabled(userId: string, kind: PushKind): Promise<boolean> {
  return !(await disabledPushKinds(userId)).has(kind);
}
