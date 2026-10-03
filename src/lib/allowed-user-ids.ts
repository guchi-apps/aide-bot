import { db } from "@/lib/db";
import { isAllowedEmail } from "@/lib/allowed-users";

/**
 * 許可リストに残っている利用者だけに絞る（cronなど、ログインセッションを通らない経路用）。
 */
export async function allowedUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true },
  });

  return users.filter((user) => isAllowedEmail(user.email)).map((user) => user.id);
}

/** 利用者IDから許可リストを再確認する。遅延実行される自動処理の入口で使う。 */
export async function isAllowedUserId(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  return isAllowedEmail(user?.email);
}
