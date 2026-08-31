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
 */

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

export type CodexResult = {
  /** 受け取れた返答の全文。中断・失敗のときは空文字。 */
  text: string;
  /** 呼び出し側が渡した`signal`が中断されて終わった。 */
  interrupted: boolean;
  /** 利用者へ出す文言。中断のときは`null`。 */
  errorMessage: string | null;
};

/** `codex exec --json` が出すJSONLの1行。実際に使う項目だけを緩く宣言する。 */
type CodexEvent = {
  type: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
  message?: string;
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
 */
export async function runCodexExec(params: {
  model: string;
  prompt: string;
  signal: AbortSignal;
}): Promise<CodexResult> {
  const { model, prompt, signal } = params;

  return new Promise((resolve) => {
    // `CODEX_BIN` は動的な文字列（環境変数）で、ファイルパスではなくPATH解決されるコマンド名。
    // 静的トレースに任せるとNext.jsがプロジェクト全体をデプロイ成果物へ含めようとするため、
    // ここでは対象から外す。
    const child = spawn(
      /* turbopackIgnore: true */ CODEX_BIN,
      [
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
    let errorMessage: string | null = null;
    let interrupted = false;
    let settled = false;
    let stdoutBuffer = "";
    let stderrLog = "";

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
        interrupted: false,
        errorMessage: "返答の生成に必要な設定がサーバー側にありません。管理者に連絡してください。",
      });
    });

    child.on("close", (code) => {
      if (interrupted) {
        finish({ text: "", interrupted: true, errorMessage: null });
        return;
      }

      if (code !== 0 && !errorMessage) {
        console.error("[aide-bot] codex exec が非0で終了した", { code, stderrLog });
        errorMessage = "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
      }

      finish({ text, interrupted: false, errorMessage });
    });
  });
}
