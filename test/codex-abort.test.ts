/**
 * `runCodexExec()` は、呼ばれる前にすでに中断されていたら子プロセスを起動しない（#259）。
 *
 * `abort` イベントは中断の瞬間に一度だけ発火し、後から付けたリスナーには届かない。
 * `signal.aborted` を見ていないと、打ち切ったはずの生成が最後まで走る。
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "codex-abort-"));
const marker = join(dir, "started");
const stub = join(dir, "codex-stub.sh");

// 起動されたら目印を残すだけのスタブ。`CODEX_BIN` はモジュールの読み込み時に読まれるので、
// importより前に環境変数を置く。
writeFileSync(stub, `#!/bin/sh\ntouch ${JSON.stringify(marker)}\ncat >/dev/null\n`);
chmodSync(stub, 0o755);
process.env.CODEX_BIN = stub;

after(() => rmSync(dir, { recursive: true, force: true }));

const { runCodexExec } = await import("@/lib/codex");

describe("runCodexExec", () => {
  it("すでに中断されていたら起動せず、interrupted を返す", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runCodexExec({ model: "gpt-5.6-luna", prompt: "こんにちは", signal: controller.signal });

    assert.equal(result.interrupted, true);
    assert.equal(result.errorMessage, null);
    assert.equal(result.reply, "");
    assert.equal(result.usage, null);
    // 起動していれば、スタブが目印を作るぶんの時間は十分に待った。
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(existsSync(marker), false);
  });

  it("中断されていなければ起動する", async () => {
    const controller = new AbortController();

    const result = await runCodexExec({ model: "gpt-5.6-luna", prompt: "こんにちは", signal: controller.signal });

    assert.equal(result.interrupted, false);
    assert.equal(existsSync(marker), true);
  });
});
