import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * 引き継ぎ用の行（#441）へ置くセッションのトークンの暗号化。
 *
 * 行は60秒だけ存在し、消費時に消す。それでもDBへ平文のトークンは置かない。
 * このアプリには暗号化専用の鍵が無く、新しいシークレットを足すと1Password・マニフェストの
 * 手作業が増えるため、サーバーだけが持つ既存の秘密（`VAPID_PRIVATE_KEY`）からHKDFで
 * 用途専用の鍵を導く（用途の印 `info` が違えば別の鍵になる）。
 * 秘密が未設定ならログインの引き継ぎごと閉じる（平文へ落とさない）。
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const INFO = "morrow-native-auth-handoff-v1";

function getKey(): Buffer {
  const secret = process.env.VAPID_PRIVATE_KEY;
  if (!secret) {
    throw new Error("VAPID_PRIVATE_KEY is not set");
  }
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

export function encryptSession(plainText: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
  return `${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSession(cipherText: string): string {
  const [ivB64, authTagB64, encryptedB64] = cipherText.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid cipher text format");
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, "base64")),
    decipher.final(),
  ]).toString("utf-8");
}
