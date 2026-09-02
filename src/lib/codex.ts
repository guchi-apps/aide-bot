import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

/**
 * 相談（チャット）の返答生成（#128）。
 *
 * Anthropic Messages APIの代わりに、ローカルにインストール・ログイン済みの`codex` CLI
 * （ChatGPTのサブスク枠で動く）を `codex exec --json` でサブプロセス起動して使う。
 *
 * **このモジュールはサーバー専用。** `node:child_process` を引き込むため、
 * クライアントコンポーネントからimportしないこと。
 *
 * **`codex exec` はトークン単位でストリーミングしない。** 実機確認（2026-08-31）では、
 * 応答全体が1つの `item.completed`（`type: "agent_message"`）イベントとして届いた。
 * Anthropicの `content_block_delta` のような細切れの配信は無いため、呼び出し側
 * （`/api/chat`）は「応答が完結してから1回だけ `delta` イベントを送る」形になる。
 *
 * **中断（#48）しても、そこまでの本文は取り出せない。** 本文は完了時にしか届かないため、
 * 生成中に打ち切ると保存すべき本文が空になる。
 *
 * **使ったトークン数は `turn.completed` の `usage` に載る（#133）。** 取れないのは
 * ChatGPTサブスクの利用枠（5時間ローリング・週次）の消費率だけで、トークン量は取れる。
 * 呼び出し側はこれを `ApiUsage` の1行として残す（`recordApiUsage()`。`@/lib/usage`）。
 */

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

/**
 * 1回の`codex exec`で使ったトークン数（#133）。
 *
 * **`ApiUsage` の列と同じ意味に均してある。** Codexが返す `input_tokens` は
 * キャッシュ読み・キャッシュ書きを**含んだ総量**で、Anthropicの `input_tokens`
 * （キャッシュに載らなかった残りだけ）とは意味が逆。ここで引き算しておかないと、
 * 画面が `inputTokens + cacheReadTokens + cacheWriteTokens` で合計を作る（`promptTokens()`）
 * ときに入力ぶんを二重に数える。
 */
export type CodexUsage = {
  /** キャッシュに載らなかった入力ぶんだけ。 */
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export type CodexResult = {
  /** 受け取れた返答の全文（`agent_message` を届いた順に連結したもの）。中断・失敗のときは空文字。 */
  text: string;
  /**
   * 届いた `agent_message` を1件ずつ持ったもの（#144）。
   *
   * **`--search` を付けると、検索の前に「調べます」の一言が別の `agent_message` として先に
   * 届く**（実測。サブPC・`codex-cli 0.152.1`・2026-09-02）。`text` はそれも連結してしまうので、
   * 返答の形を決めて読み取る経路（話題の仕入れ）は最後の1件だけを読む。
   */
  messages: string[];
  /** 呼び出し側が渡した`signal`が中断されて終わった。 */
  interrupted: boolean;
  /** 利用者へ出す文言。中断のときは`null`。 */
  errorMessage: string | null;
  /**
   * 使ったトークン数。**`turn.completed` が届かなかった回（中断・起動失敗）は`null`。**
   *
   * 中断しても本文が取れないのと同じ理由で、途中までの消費量も分からない。推定で埋めず、
   * 記録しないでおく（#51「埋め合わせの推定はしない」と同じ扱い）。
   */
  usage: CodexUsage | null;
};

/** `codex exec --json` が出すJSONLの1行。実際に使う項目だけを緩く宣言する。 */
type CodexEvent = {
  type: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
  message?: string;
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    cache_write_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
};

/**
 * `codex exec --json` を実行し、返答の本文を取り出す。
 *
 * - `--sandbox read-only` / `--ephemeral` / `--ignore-user-config`：秘書チャット用途に
 *   絞り、シェル実行やファイル改変、セッションの永続化、利用者の`~/.codex/config.toml`の
 *   持ち込み（MCP設定等）をさせない
 * - `--skip-git-repo-check`：Next.jsのRoute Handlerのカレントディレクトリはgitリポジトリの
 *   中だが、Codexにリポジトリの中身を読ませる理由が無いため、作業ディレクトリは
 *   `os.tmpdir()` に切り離す（`-C`）
 * - プロンプトは引数で渡し、標準入力は`ignore`にする。標準入力をパイプすると
 *   「Reading additional input from stdin...」という案内とともにその内容がプロンプトへ
 *   追記される仕様があるため
 * - `search` を立てると `--search`（ウェブ検索）を付ける（#144）。**このフラグは `exec` の
 *   サブコマンドではなく `codex` 本体の引数**なので、`exec` より前に置く（`codex exec --help`
 *   には出ず、`codex --help` にだけ出る）。読み取り専用のサンドボックスと両立する（実測）
 */
export async function runCodexExec(params: {
  model: string;
  prompt: string;
  signal: AbortSignal;
  search?: boolean;
}): Promise<CodexResult> {
  const { model, prompt, signal, search = false } = params;

  return new Promise((resolve) => {
    // `CODEX_BIN` は動的な文字列（環境変数）で、ファイルパスではなくPATH解決されるコマンド名。
    // 静的トレースに任せるとNext.jsがプロジェクト全体をデプロイ成果物へ含めようとするため、
    // ここでは対象から外す。
    const child = spawn(
      /* turbopackIgnore: true */ CODEX_BIN,
      [
        ...(search ? ["--search"] : []),
        "exec",
        "--json",
        "-m",
        model,
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "-C",
        tmpdir(),
        prompt,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let text = "";
    const messages: string[] = [];
    let errorMessage: string | null = null;
    let interrupted = false;
    let settled = false;
    let stdoutBuffer = "";
    let stderrLog = "";
    let usage: CodexUsage | null = null;

    const onAbort = () => {
      interrupted = true;
      child.kill("SIGTERM");
    };
    signal.addEventListener("abort", onAbort);

    const finish = (result: CodexResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") continue;

        let event: CodexEvent;
        try {
          event = JSON.parse(line) as CodexEvent;
        } catch {
          // JSONLとして読めない行（案内文など）は無視する。
          continue;
        }

        if (event.type === "item.completed" && event.item?.type === "agent_message") {
          text += event.item.text ?? "";
          messages.push(event.item.text ?? "");
        } else if (event.type === "turn.completed" && event.usage) {
          usage = addUsage(usage, event.usage);
        } else if (event.type === "turn.failed" || event.type === "error") {
          errorMessage =
            event.error?.message ?? event.message ?? "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrLog += chunk;
    });

    child.on("error", (error) => {
      console.error("[aide-bot] codex exec の起動に失敗した", error);
      finish({
        text: "",
        messages: [],
        interrupted: false,
        errorMessage: "返答の生成に必要な設定がサーバー側にありません。管理者に連絡してください。",
        usage: null,
      });
    });

    child.on("close", (code) => {
      if (interrupted) {
        finish({ text: "", messages: [], interrupted: true, errorMessage: null, usage: null });
        return;
      }

      if (code !== 0 && !errorMessage) {
        console.error("[aide-bot] codex exec が非0で終了した", { code, stderrLog });
        errorMessage = "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
      }

      finish({ text, messages, interrupted: false, errorMessage, usage });
    });
  });
}

/**
 * `turn.completed` の `usage` を `ApiUsage` の列に均して足し込む（#133）。
 *
 * **`input_tokens` は総量なので、キャッシュぶんを引く。** 実測（サブPC・`codex-cli 0.152.1`・
 * 2026-09-02）では、同じ条件のプロンプトへ約12,000トークンぶんを足すと `input_tokens` だけが
 * 12,121→24,133と増え、`cached_input_tokens` は8,960→11,008で据え置きだった。
 *
 * **`reasoning_output_tokens` は足さない。** 実測ではSolに考えさせる問いを投げても常に0で、
 * `output_tokens` との包含関係を確かめられなかった（OpenAIのAPIでは推論ぶんは出力ぶんの
 * 内訳として数えられる）。二重に数える方が実害が大きいので、値が入るようになったら
 * 包含関係を確かめてから足すこと。
 *
 * 1回の`codex exec`で `turn.completed` は1つだが、複数届いても足せるようにしてある。
 */
function addUsage(current: CodexUsage | null, raw: NonNullable<CodexEvent["usage"]>): CodexUsage {
  const base = current ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 };

  const cacheRead = raw.cached_input_tokens ?? 0;
  const cacheWrite = raw.cache_write_input_tokens ?? 0;

  return {
    inputTokens: base.inputTokens + Math.max(0, (raw.input_tokens ?? 0) - cacheRead - cacheWrite),
    outputTokens: base.outputTokens + (raw.output_tokens ?? 0),
    cacheWriteTokens: base.cacheWriteTokens + cacheWrite,
    cacheReadTokens: base.cacheReadTokens + cacheRead,
  };
}
