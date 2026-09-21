/**
 * ログアウトは、このアプリのセッションだけを破棄する（#292）。
 *
 * 共有Supabaseで `signOut()` を引数なしで呼ぶと `scope: "global"` になり、同じユーザーの
 * 他アプリ・他端末のrefresh tokenまで失効する。通常のログアウトも、許可外のアカウントの
 * 破棄も、`signOutThisApp()` を通って `scope: "local"` を渡すことを固定する。
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import { signOutThisApp } from "@/lib/supabase/sign-out";

const SRC = join(import.meta.dirname, "..", "src");
const HELPER = join(SRC, "lib", "supabase", "sign-out.ts");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("signOutThisApp", () => {
  it("scope: local を渡す", async () => {
    const calls: unknown[] = [];
    const client = {
      auth: {
        signOut: async (options: { scope: "local" }) => {
          calls.push(options);
          return { error: null };
        },
      },
    };

    const result = await signOutThisApp(client);

    assert.deepEqual(calls, [{ scope: "local" }]);
    assert.equal(result.error, null);
  });

  it("失敗はそのまま呼び出し元へ返す", async () => {
    const client = {
      auth: { signOut: async () => ({ error: { message: "失敗" } }) },
    };

    assert.deepEqual(await signOutThisApp(client), { error: { message: "失敗" } });
  });
});

describe("src/ の signOut 呼び出し", () => {
  it("signOut() を直接呼ぶのは signOutThisApp() の1か所だけ", () => {
    const direct = sourceFiles(SRC)
      .filter((file) => file !== HELPER)
      .filter((file) => /\.signOut\s*\(/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));

    assert.deepEqual(direct, []);
  });

  it("ヘルパの中の呼び出しは scope: local を渡している", () => {
    const code = readFileSync(HELPER, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const calls = code.match(/\.signOut\s*\([^)]*\)/g) ?? [];

    // 型の宣言（`signOut(options: …)`）は `.` が付かないので、ここへは入らない。
    assert.deepEqual(calls, ['.signOut({ scope: "local" })']);
  });
});
