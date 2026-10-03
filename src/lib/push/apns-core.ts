import { createHash, createPrivateKey, sign } from "node:crypto";

/**
 * APNs（iOSアプリへのプッシュ。#475）のうち、DBにもネットワークにも触れない部分。
 * 送信そのもの（`apns.ts`）から切り出してあるのは、`test/apns.test.ts` が素のNodeで読めるようにするため。
 */

/** iOSアプリのBundle ID。APNsの `apns-topic`。`ios/Morrow.xcodeproj` の `PRODUCT_BUNDLE_IDENTIFIER` と揃える。 */
export const APNS_TOPIC = "com.gucchii.morrow";

export type ApnsEnvironment = "production" | "sandbox";

export const APNS_ENVIRONMENTS: readonly ApnsEnvironment[] = ["production", "sandbox"];

export function isApnsEnvironment(value: unknown): value is ApnsEnvironment {
  return value === "production" || value === "sandbox";
}

/** APNsの接続先。 */
export function apnsOrigin(environment: ApnsEnvironment): string {
  return environment === "production"
    ? "https://api.push.apple.com"
    : "https://api.sandbox.push.apple.com";
}

/** デバイストークンは16進文字列（32バイト以上）。列（200文字）に入らない値・16進でない値は受け付けない。 */
export function parseDeviceToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase();
  if (!/^[0-9a-f]{64,160}$/.test(token)) return null;
  return token;
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * `.p8` の中身を秘密鍵のPEMへ直す。
 *
 * マニフェストの `ASC_KEY_P8` と同じく「`AuthKey_XXXX.p8` の中身をbase64で1行にした値」を
 * 想定するが、PEMそのもの（`\n` が文字として入ったものを含む）も受け付ける。
 */
export function normalizeP8(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return null;

  const pem = text.includes("-----BEGIN")
    ? text.replace(/\\n/g, "\n")
    : Buffer.from(text, "base64").toString("utf8");

  return pem.includes("-----BEGIN PRIVATE KEY-----") ? pem : null;
}

export type ApnsCredentials = { keyId: string; teamId: string; privateKeyPem: string };

/** 環境変数から認証情報を作る。1つでも欠ける・読めない場合はnull（APNsの経路ごと無効）。 */
export function apnsCredentials(env: Record<string, string | undefined> = process.env): ApnsCredentials | null {
  const keyId = (env.APNS_KEY_ID ?? "").trim();
  const teamId = (env.APNS_TEAM_ID ?? "").trim();
  const privateKeyPem = normalizeP8(env.APNS_KEY_P8 ?? "");

  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId) || privateKeyPem === null) {
    return null;
  }
  return { keyId, teamId, privateKeyPem };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** プロバイダ認証トークン（ES256のJWT）。APNsは20分〜60分の間で作り直すことを求める。 */
export function createProviderToken(credentials: ApnsCredentials, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }));
  const claims = base64url(JSON.stringify({ iss: credentials.teamId, iat: nowSeconds }));
  const signingInput = `${header}.${claims}`;

  const signature = sign("sha256", Buffer.from(signingInput), {
    key: createPrivateKey(credentials.privateKeyPem),
    // JWSのES256は r||s の固定長（DER形式ではない）
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${base64url(signature)}`;
}

export type ApnsMessage = { title: string; body: string; url: string; tag?: string };

/** APNsへ送る本文。`url` は殻が通知を押されたときに開く先として読む（`PushPayload.url` と同じ意味）。 */
export function buildApnsBody(message: ApnsMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
      ...(message.tag ? { "thread-id": message.tag } : {}),
    },
    url: message.url,
  });
}

/** `apns-collapse-id`（64バイトまで）。同じ理由の通知を端末側でも上書きする。 */
export function collapseId(tag: string | undefined): string | null {
  if (!tag) return null;
  return Buffer.byteLength(tag) <= 64 ? tag : createHash("sha256").update(tag).digest("hex");
}

/**
 * APNsの失敗理由から、そのトークンを消すべきかを決める。
 * 410（Unregistered）と、トークンそのものが無効なときの400だけ。
 * `DeviceTokenNotForTopic`・`BadEnvironment` などは設定側の問題で、消しても直らない。
 */
export function shouldDeleteToken(status: number, reason: string | null): boolean {
  if (status === 410) return true;
  return status === 400 && (reason === "BadDeviceToken" || reason === "Unregistered");
}
