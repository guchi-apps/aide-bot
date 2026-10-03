import assert from "node:assert/strict";
import test from "node:test";

import { consumeHandoff, issueHandoff, type HandoffRecord, type HandoffStore } from "../src/lib/native-auth/handoff.ts";
import { hashToken, isValidChallenge, isValidVerifier, s256Challenge } from "../src/lib/native-auth/tokens.ts";

function memoryStore() {
  const rows = new Map<string, HandoffRecord & { used: boolean }>();
  const store: HandoffStore = {
    async create(r) {
      rows.set(r.codeHash, { ...r, used: false });
    },
    async claim(codeHash, purpose, now) {
      const r = rows.get(codeHash);
      if (!r || r.used || r.purpose !== purpose || r.expiresAt <= now) return null;
      r.used = true;
      return { challengeHash: r.challengeHash, sessionCipher: r.sessionCipher, next: r.next };
    },
  };
  return { store, rows };
}

const verifier = "a".repeat(64);
const challenge = s256Challenge(verifier);
const now = new Date("2026-10-02T00:00:00Z");

test("PKCEの形: verifierは43〜128文字、challengeはS256の43文字", () => {
  assert.ok(isValidVerifier(verifier));
  assert.ok(!isValidVerifier("short"));
  assert.ok(isValidChallenge(challenge));
  assert.ok(!isValidChallenge(verifier));
});

test("発行したコードはverifierと一緒なら一度だけ消費でき、DBには平文のコードを置かない", async () => {
  const { store, rows } = memoryStore();
  const code = await issueHandoff({ store, challenge, sessionCipher: "cipher", next: "/", now });
  assert.ok(!rows.has(code));
  assert.ok(rows.has(hashToken(code)));
  assert.deepEqual(await consumeHandoff({ store, code, verifier, now }), { sessionCipher: "cipher", next: "/" });
  assert.equal(await consumeHandoff({ store, code, verifier, now }), null);
});

test("verifier不一致・期限切れ・未知のコードは拒否し、不一致でもコードは燃える", async () => {
  const { store } = memoryStore();
  const code = await issueHandoff({ store, challenge, sessionCipher: "c", next: null, now });
  assert.equal(await consumeHandoff({ store, code, verifier: "b".repeat(64), now }), null);
  assert.equal(await consumeHandoff({ store, code, verifier, now }), null);

  const late = await issueHandoff({ store, challenge, sessionCipher: "c", next: null, now });
  assert.equal(await consumeHandoff({ store, code: late, verifier, now: new Date(now.getTime() + 61_000) }), null);
  assert.equal(await consumeHandoff({ store, code: "unknown", verifier, now }), null);
});
