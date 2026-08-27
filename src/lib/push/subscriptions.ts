import { createHash } from "node:crypto";

import webpush from "web-push";

import { db } from "@/lib/db";
import { VAPID_SUBJECT, isPushConfigured, pushPrivateKey, pushPublicKey } from "@/lib/push/config";

/**
 * Web Pushの購読の出し入れと送信（#79）。**サーバー専用**（Prismaとweb-pushを引き込む）。
 *
 * 端末ごとに1行持つ。1人の利用者がiPhoneとPCの両方から購読するため、「利用者に送る」は
 * 「その利用者の全購読へ送る」になる。
 */

/** ブラウザの `PushSubscription.toJSON()` の形。 */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** 通知1件ぶんの中身。Service Worker（`public/sw.js`）がこの形を前提に組み立てる。 */
export type PushPayload = {
  title: string;
  body: string;
  /** 押したときに開くパス。同じオリジンの相対パスで持つ。 */
  url: string;
  /** 同じ理由の通知を端末側でも上書きするための印。 */
  tag?: string;
};

/**
 * `endpoint` のハッシュ。一意制約はこちらに張る。
 *
 * endpointはブラウザベンダーが発行するURLで数百文字になることがあり、MariaDBは長いTEXTへ
 * そのまま一意制約を張れない（guchi-apps/signaly も同じ手を採っている）。
 */
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/**
 * User-Agentから端末の覚え書きを作る。
 *
 * 設定の画面に「登録済みの端末」を件数で出すため、どれがどれか分かる程度で足りる。
 * 厳密に判定しようとすると当たらない端末が必ず出るので、素直に代表的な語を拾うだけにする。
 */
export function deviceLabelFromUserAgent(userAgent: string | null): string {
  const ua = userAgent ?? "";

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "不明な端末";

  // 判定の順は大事。ChromeもEdgeも Safari を名乗り、EdgeはChromeも名乗る。
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";

  return (browser === "" ? os : `${os} / ${browser}`).slice(0, 120);
}

/**
 * 購読を保存する（同じendpointなら上書き）。
 *
 * 上書きにするのは、同じ端末で許可を取り直すと鍵だけが変わることがあるため。行を増やすと
 * 同じ端末へ二重に送ることになる。
 */
export async function saveSubscription(params: {
  userId: string;
  subscription: PushSubscriptionInput;
  userAgent: string | null;
}): Promise<void> {
  const hash = endpointHash(params.subscription.endpoint);

  const data = {
    userId: params.userId,
    endpoint: params.subscription.endpoint,
    endpointHash: hash,
    p256dh: params.subscription.keys.p256dh,
    auth: params.subscription.keys.auth,
    deviceLabel: deviceLabelFromUserAgent(params.userAgent),
  };

  await db.pushSubscription.upsert({
    where: { endpointHash: hash },
    // 端末を別の利用者が使い始めることもあるので userId も含めて更新する。
    update: data,
    create: data,
  });
}

/** 購読を消す。他人の行を消せないよう、必ずuserIdとの組で消す。 */
export async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  await db.pushSubscription.deleteMany({
    where: { userId, endpointHash: endpointHash(endpoint) },
  });
}

/** この利用者が登録している端末の数。設定の画面に出す。 */
export function countSubscriptions(userId: string): Promise<number> {
  return db.pushSubscription.count({ where: { userId } });
}

/** 通知を送れる相手（購読を1件以上持っている利用者）のID。 */
export async function usersWithSubscriptions(): Promise<string[]> {
  const rows = await db.pushSubscription.findMany({
    distinct: ["userId"],
    select: { userId: true },
    orderBy: { userId: "asc" },
  });

  return rows.map((row) => row.userId);
}

let configured = false;

function ensureVapid(): void {
  if (configured) return;
  webpush.setVapidDetails(VAPID_SUBJECT, pushPublicKey(), pushPrivateKey());
  configured = true;
}

/**
 * 利用者の全端末へ通知を送り、届いた件数を返す。
 *
 * **例外は投げない。** 通知はこのアプリの主機能ではなく、失敗が相談や朝の見通しの生成を
 * 巻き込んではいけない（AIDEの `src/worker/notify.ts` と同じ方針）。
 *
 * 送信が 404 / 410 で返った購読は**その場で消す**。ブラウザ側で通知を切られた・アプリを
 * ホーム画面から消された購読は二度と復活しないため、残しておくと毎回失敗し続ける。
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!isPushConfigured()) {
    console.error("[aide-bot] VAPIDの鍵が未設定のため通知を送れない");
    return 0;
  }

  ensureVapid();

  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  const body = JSON.stringify(payload);
  let delivered = 0;

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
      );

      delivered += 1;
      await db.pushSubscription.update({
        where: { id: subscription.id },
        data: { lastNotifiedAt: new Date() },
      });
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;

      if (statusCode === 404 || statusCode === 410) {
        await db.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => {});
        console.warn(
          `[aide-bot] 失効した購読を削除した: ${subscription.deviceLabel} (${statusCode})`,
        );
        continue;
      }

      // 鍵の不一致・Pushサービス側の障害・名前解決の失敗など。
      //
      // **ステータスコードだけをログに出さないこと。** 通信そのものが成立しなかった場合
      // （DNS・TLS・接続拒否）は `statusCode` が付かず、「不明」としか残らないため、
      // 何が起きたのか手掛かりが1つも残らない。原因はほぼ例外のメッセージ側にある。
      const reason = statusCode ?? (error instanceof Error ? error.message : "不明");
      console.error(
        `[aide-bot] 通知の送信に失敗した: ${subscription.deviceLabel} (${String(reason).slice(0, 200)})`,
      );
    }
  }

  return delivered;
}
