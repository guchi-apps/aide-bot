/**
 * APNs（iOSアプリへの通知。#475）の、DBにもネットワークにも触れない部分。
 * 送信の本体（`apns.ts`）はPrismaを引き込むので読まない。
 */
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, it } from "node:test";

import {
  APNS_TOPIC,
  apnsCredentials,
  apnsOrigin,
  buildApnsBody,
  collapseId,
  createProviderToken,
  normalizeP8,
  parseDeviceToken,
  shouldDeleteToken,
} from "@/lib/push/apns-core";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const base64Pem = Buffer.from(pem).toString("base64");

describe("認証情報", () => {
  const env = { APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "6AA3WFTR94", APNS_KEY_P8: base64Pem };

  it("3つ揃えば作れる（base64でもPEMでも）", () => {
    assert.ok(apnsCredentials(env));
    assert.ok(apnsCredentials({ ...env, APNS_KEY_P8: pem }));
    assert.ok(apnsCredentials({ ...env, APNS_KEY_P8: pem.replace(/\n/g, "\\n") }));
  });

  it("1つでも欠ける・形が違えばnull（経路ごと無効）", () => {
    assert.equal(apnsCredentials({ ...env, APNS_KEY_ID: "" }), null);
    assert.equal(apnsCredentials({ ...env, APNS_TEAM_ID: "short" }), null);
    assert.equal(apnsCredentials({ ...env, APNS_KEY_P8: "" }), null);
    assert.equal(apnsCredentials({ ...env, APNS_KEY_P8: "bm90IGEga2V5" }), null);
    assert.equal(apnsCredentials({}), null);
  });

  it("normalizeP8 は鍵でない値を弾く", () => {
    assert.equal(normalizeP8("-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----"), null);
  });
});

describe("プロバイダトークン（ES256のJWT）", () => {
  it("ヘッダ・クレームが正しく、署名が公開鍵で検証できる", () => {
    const credentials = { keyId: "ABC123DEFG", teamId: "6AA3WFTR94", privateKeyPem: pem };
    const jwt = createProviderToken(credentials, 1_700_000_000);
    const [header, claims, signature] = jwt.split(".");

    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
      iss: "6AA3WFTR94",
      iat: 1_700_000_000,
    });

    const raw = Buffer.from(signature, "base64url");
    assert.equal(raw.length, 64, "JWSのES256は r||s の64バイト");
    assert.ok(
      verify(
        "sha256",
        Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        raw,
      ),
    );
  });
});

describe("トークン・本文", () => {
  it("デバイストークンは16進だけを小文字へ寄せて受ける", () => {
    const token = "AB".repeat(32);
    assert.equal(parseDeviceToken(token), token.toLowerCase());
    assert.equal(parseDeviceToken("zz".repeat(32)), null);
    assert.equal(parseDeviceToken("ab"), null);
    assert.equal(parseDeviceToken("a".repeat(161)), null);
    assert.equal(parseDeviceToken(123), null);
  });

  it("本文は aps.alert と遷移先 url を持つ", () => {
    const body = JSON.parse(buildApnsBody({ title: "t", body: "b", url: "/x", tag: "brief" }));
    assert.deepEqual(body, {
      aps: { alert: { title: "t", body: "b" }, sound: "default", "thread-id": "brief" },
      url: "/x",
    });
    assert.equal("thread-id" in JSON.parse(buildApnsBody({ title: "t", body: "b", url: "/" })).aps, false);
  });

  it("collapse-id は64バイトに収める", () => {
    assert.equal(collapseId(undefined), null);
    assert.equal(collapseId("brief"), "brief");
    assert.equal(collapseId("あ".repeat(30))?.length, 64);
  });

  it("接続先とtopic", () => {
    assert.equal(apnsOrigin("production"), "https://api.push.apple.com");
    assert.equal(apnsOrigin("sandbox"), "https://api.sandbox.push.apple.com");
    assert.equal(APNS_TOPIC, "com.gucchii.morrow");
  });
});

describe("失効したトークンの扱い", () => {
  it("410とトークン無効の400だけ消す", () => {
    assert.equal(shouldDeleteToken(410, "Unregistered"), true);
    assert.equal(shouldDeleteToken(400, "BadDeviceToken"), true);
    assert.equal(shouldDeleteToken(400, "DeviceTokenNotForTopic"), false);
    assert.equal(shouldDeleteToken(403, "InvalidProviderToken"), false);
    assert.equal(shouldDeleteToken(500, null), false);
  });
});
