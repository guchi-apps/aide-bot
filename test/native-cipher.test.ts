import assert from "node:assert/strict";
import test from "node:test";

import { decryptSession, encryptSession } from "../src/lib/native-auth/cipher.ts";

test("セッションの暗号化は往復でき、平文を含まず、秘密が無ければ失敗する", () => {
  process.env.VAPID_PRIVATE_KEY = "test-secret";
  const plain = JSON.stringify({ accessToken: "a.b.c", refreshToken: "r" });
  const cipher = encryptSession(plain);
  assert.ok(!cipher.includes("a.b.c"));
  assert.equal(decryptSession(cipher), plain);
  assert.notEqual(encryptSession(plain), cipher);

  process.env.VAPID_PRIVATE_KEY = "other-secret";
  assert.throws(() => decryptSession(cipher));
  delete process.env.VAPID_PRIVATE_KEY;
  assert.throws(() => encryptSession(plain));
});
