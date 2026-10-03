import { connect, constants, type ClientHttp2Session } from "node:http2";

import { db } from "@/lib/db";
import { deviceLabelFromUserAgent } from "@/lib/push/subscriptions-core";
import {
  APNS_TOPIC,
  apnsCredentials,
  apnsOrigin,
  buildApnsBody,
  collapseId,
  createProviderToken,
  shouldDeleteToken,
  tokenHash,
  type ApnsCredentials,
  type ApnsEnvironment,
  type ApnsMessage,
} from "@/lib/push/apns-core";

/**
 * iOSアプリ（WKWebViewの殻）へのAPNs送信と、デバイストークンの出し入れ（#475）。**サーバー専用。**
 *
 * 依存は足していない。APNsのHTTP/2と、ES256のJWTはNode標準の `http2`・`crypto` で足りる。
 * 認証情報（`APNS_KEY_ID`・`APNS_TEAM_ID`・`APNS_KEY_P8`）が揃っていないときは経路ごと無効で、
 * Web Pushだけが動く（`isApnsConfigured()`）。
 */

export function isApnsConfigured(): boolean {
  return apnsCredentials() !== null;
}

/** トークンを保存する（同じトークンなら上書き）。端末を別の利用者が使い始めたときも持ち主が移る。 */
export async function saveApnsDevice(params: {
  userId: string;
  token: string;
  environment: ApnsEnvironment;
  userAgent: string | null;
}): Promise<void> {
  const hash = tokenHash(params.token);
  const data = {
    userId: params.userId,
    token: params.token,
    tokenHash: hash,
    environment: params.environment,
    deviceLabel: deviceLabelFromUserAgent(params.userAgent),
  };

  await db.apnsDevice.upsert({ where: { tokenHash: hash }, update: data, create: data });
}

/** トークンを消す。他人の行を消せないよう、必ずuserIdとの組で消す。 */
export async function deleteApnsDevice(userId: string, token: string): Promise<void> {
  await db.apnsDevice.deleteMany({ where: { userId, tokenHash: tokenHash(token) } });
}

export function countApnsDevices(userId: string): Promise<number> {
  return db.apnsDevice.count({ where: { userId } });
}

export async function usersWithApnsDevices(): Promise<string[]> {
  const rows = await db.apnsDevice.findMany({
    distinct: ["userId"],
    select: { userId: true },
    orderBy: { userId: "asc" },
  });
  return rows.map((row) => row.userId);
}

/** プロバイダトークンは使い回す（APNsは頻繁な作り直しを `TooManyProviderTokenUpdates` で断る）。 */
const TOKEN_TTL_SECONDS = 50 * 60;
let cachedToken: { value: string; issuedAt: number; keyId: string } | null = null;

function providerToken(credentials: ApnsCredentials, nowSeconds: number): string {
  if (
    cachedToken &&
    cachedToken.keyId === credentials.keyId &&
    nowSeconds - cachedToken.issuedAt < TOKEN_TTL_SECONDS
  ) {
    return cachedToken.value;
  }

  const value = createProviderToken(credentials, nowSeconds);
  cachedToken = { value, issuedAt: nowSeconds, keyId: credentials.keyId };
  return value;
}

type SendResult = { status: number; reason: string | null };

function sendOne(
  session: ClientHttp2Session,
  credentials: ApnsCredentials,
  token: string,
  body: string,
  collapse: string | null,
): Promise<SendResult> {
  return new Promise((resolve, reject) => {
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      authorization: `bearer ${providerToken(credentials, Math.floor(Date.now() / 1000))}`,
      "apns-topic": APNS_TOPIC,
      "apns-push-type": "alert",
      "apns-priority": "10",
      ...(collapse ? { "apns-collapse-id": collapse } : {}),
    });

    request.setTimeout(10_000, () => request.close(constants.NGHTTP2_CANCEL));

    let status = 0;
    let text = "";
    request.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      text += chunk;
    });
    request.on("end", () => {
      let reason: string | null = null;
      try {
        const parsed = JSON.parse(text) as { reason?: unknown };
        if (typeof parsed.reason === "string") reason = parsed.reason;
      } catch {
        // 成功（200）は本文が空
      }
      resolve({ status, reason });
    });
    request.on("error", reject);
    request.end(body);
  });
}

/**
 * 利用者のiOSアプリ全端末へ送り、届いた件数を返す。**例外は投げない**（`sendPushToUser()` と同じ方針）。
 * 失効したトークン（410など）はその場で消す。
 */
export async function sendApnsToUser(userId: string, message: ApnsMessage): Promise<number> {
  const credentials = apnsCredentials();
  if (!credentials) return 0;

  const devices = await db.apnsDevice.findMany({ where: { userId } });
  if (devices.length === 0) return 0;

  const body = buildApnsBody(message);
  const collapse = collapseId(message.tag);
  let delivered = 0;

  for (const environment of ["production", "sandbox"] as const) {
    const targets = devices.filter((device) => device.environment === environment);
    if (targets.length === 0) continue;

    // 接続先の差し替えはテスト用（スタブのHTTP/2サーバー）。本番の設定には出てこない。
    const origin = process.env.APNS_ORIGIN_OVERRIDE || apnsOrigin(environment);
    let session: ClientHttp2Session;
    try {
      session = connect(origin);
      session.on("error", () => {});
    } catch (error) {
      console.error(`[aide-bot] APNsへ接続できない: ${error instanceof Error ? error.message : "不明"}`);
      continue;
    }

    try {
      for (const device of targets) {
        try {
          const result = await sendOne(session, credentials, device.token, body, collapse);

          if (result.status === 200) {
            delivered += 1;
            await db.apnsDevice.update({
              where: { id: device.id },
              data: { lastNotifiedAt: new Date() },
            });
            continue;
          }

          if (shouldDeleteToken(result.status, result.reason)) {
            await db.apnsDevice.delete({ where: { id: device.id } }).catch(() => {});
            console.warn(
              `[aide-bot] 失効したAPNsトークンを削除した: ${device.deviceLabel} (${result.status} ${result.reason ?? ""})`,
            );
            continue;
          }

          console.error(
            `[aide-bot] APNsの送信に失敗した: ${device.deviceLabel} (${result.status} ${result.reason ?? "不明"})`,
          );
        } catch (error) {
          // 通信が成立しなかった場合はstatusが無いので、メッセージを残す（Web Pushと同じ理由）
          console.error(
            `[aide-bot] APNsの送信に失敗した: ${device.deviceLabel} (${(error instanceof Error ? error.message : "不明").slice(0, 200)})`,
          );
        }
      }
    } finally {
      session.close();
    }
  }

  return delivered;
}
