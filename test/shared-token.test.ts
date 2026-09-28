/** 共有トークンの取得（#403）。ネットワークには出ず、`fetchImpl` を差し替えて確かめる。 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSharedToken } from "@/lib/shared-token";

const env = { baseUrl: "https://deck.example.com/", secret: "api-secret" };
const ok = (value: string) => (async () => Response.json({ name: "X", value })) as unknown as typeof fetch;
const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = original;
  }
};

describe("resolveSharedToken", () => {
  it("名前・Bearer・利用元を付けて取得する", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, headers: init.headers as Record<string, string> };
      return Response.json({ name: "A B", value: "v1" });
    }) as unknown as typeof fetch;
    const result = await resolveSharedToken("A B", null, { now: 1000, env, fetchImpl });
    assert.equal(result.value, "v1");
    assert.deepEqual(result.cache, { value: "v1", fetchedAtMs: 1000 });
    assert.equal(seen!.url, "https://deck.example.com/api/shared-tokens?name=A%20B");
    assert.equal(seen!.headers.authorization, "Bearer api-secret");
    assert.equal(seen!.headers["x-shared-token-consumer"], "aide-bot");
  });

  it("キャッシュが新しいうちは取りに行かない", async () => {
    const fetchImpl = (async () => assert.fail("呼ばれてはいけない")) as unknown as typeof fetch;
    const previous = { value: "cached", fetchedAtMs: 1000 };
    const result = await resolveSharedToken("X", previous, { now: 1000 + 9 * 60 * 1000, env, fetchImpl });
    assert.equal(result.value, "cached");
  });

  it("キャッシュが古ければ取り直す", async () => {
    const previous = { value: "old", fetchedAtMs: 0 };
    const result = await resolveSharedToken("X", previous, { now: 11 * 60 * 1000, env, fetchImpl: ok("new") });
    assert.equal(result.value, "new");
  });

  it("失敗したときは古くても直前の値を使う", async () => {
    const fetchImpl = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const previous = { value: "old", fetchedAtMs: 0 };
    const result = await quiet(() => resolveSharedToken("X", previous, { now: 20 * 60 * 1000, env, fetchImpl }));
    assert.equal(result.value, "old");
    assert.equal(result.cache, previous);
  });

  it("失敗してキャッシュも無ければnull（呼び出し側が環境変数へ落とす）", async () => {
    const fetchImpl = (async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    const result = await quiet(() => resolveSharedToken("X", null, { env, fetchImpl }));
    assert.equal(result.value, null);
  });

  it("形の違う応答・空の値は失敗として扱う", async () => {
    for (const body of [{ name: "X" }, { value: "" }, { value: 1 }, null]) {
      const fetchImpl = (async () => Response.json(body)) as unknown as typeof fetch;
      const result = await quiet(() => resolveSharedToken("X", null, { env, fetchImpl }));
      assert.equal(result.value, null);
    }
  });

  it("URLかBearerが未設定なら取りに行かない", async () => {
    const fetchImpl = (async () => assert.fail("呼ばれてはいけない")) as unknown as typeof fetch;
    assert.equal((await resolveSharedToken("X", null, { env: { baseUrl: "", secret: "s" }, fetchImpl })).value, null);
    assert.equal((await resolveSharedToken("X", null, { env: { baseUrl: "https://a", secret: "" }, fetchImpl })).value, null);
  });

  it("値もBearerもログに出さない", async () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const fetchImpl = (async () => {
        throw new Error("HTTP 401");
      }) as unknown as typeof fetch;
      await resolveSharedToken("X", { value: "secret-value", fetchedAtMs: 0 }, { now: 99999999, env, fetchImpl });
    } finally {
      console.error = original;
    }
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => !line.includes("api-secret") && !line.includes("secret-value")));
  });
});
