/**
 * ChatGPTアカウントが対応していないモデルを指定されたら、GPT-5.6系へ1度だけ落としてやり直す（#358）。
 */
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "codex-fallback-"));
const log = join(dir, "models.log");
const stub = join(dir, "codex-stub.sh");

// `-m` の次の引数（モデル名）を記録し、gpt-6系には実際と同じ形のエラーを返す。
writeFileSync(
  stub,
  `#!/bin/sh
while [ $# -gt 0 ]; do
  if [ "$1" = "-m" ]; then model="$2"; fi
  shift
done
echo "$model" >> ${JSON.stringify(log)}
cat >/dev/null
case "$model" in
  gpt-6-*) echo '{"type":"error","message":"The '"'$model'"' model is not supported when using Codex with a ChatGPT account."}'
           echo '{"type":"turn.failed","error":{"message":"The '"'$model'"' model is not supported when using Codex with a ChatGPT account."}}'
           exit 1 ;;
  *) echo '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}'
     echo '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":1}}' ;;
esac
`,
);
chmodSync(stub, 0o755);
process.env.CODEX_BIN = stub;

after(() => rmSync(dir, { recursive: true, force: true }));

const { runCodexExec, isUnsupportedModelError } = await import("@/lib/codex");

describe("対応していないモデルのフォールバック", () => {
  it("エラー文言を判定する", () => {
    assert.equal(
      isUnsupportedModelError("The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account."),
      true,
    );
    assert.equal(isUnsupportedModelError("返答の生成に失敗しました。"), false);
    assert.equal(isUnsupportedModelError(null), false);
  });

  it("gpt-6-luna が断られたら gpt-5.6-luna でやり直す", async () => {
    const result = await runCodexExec({
      model: "gpt-6-luna",
      prompt: "こんにちは",
      signal: new AbortController().signal,
    });

    assert.equal(result.errorMessage, null);
    assert.equal(result.reply, "ok");
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n"), ["gpt-6-luna", "gpt-5.6-luna"]);
  });
});
