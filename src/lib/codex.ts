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
 *
 * **繋いだ外部サービス（MCP）の道具は `-c mcp_servers.<名前>.…` で1回ごとに渡す（#131）。**
 * `--ignore-user-config` は `~/.codex/config.toml` を読まないだけで、`-c` の明示オーバーライドは
 * 独立に効く。実測（サブPC・`codex-cli 0.152.1`・2026-09-05）で確かめた点:
 *
 * - **`default_tools_approval_mode="approve"` が無いと道具を呼べない。** 非対話の `exec` は
 *   承認ポリシーが `never` で、道具の呼び出しが「MCP tool call requires approval, but approval
 *   policy is never」で失敗する
 * - **`disabled_tools=[…]` で名指しした道具はモデルに見えない**（`tools/list` の結果から落とされ、
 *   `tools/call` も飛ばない。スタブへの実測で0回）。Issue #131のコメントにある「道具ごとの
 *   enabled/disabledが無い」は見落としで、`enabled_tools` / `disabled_tools` がある
 * - **`features.apps=false` を必ず付ける。** 付けないと、利用者のChatGPTアカウントに繋いである
 *   コネクタが `codex_apps` というMCPサーバーとして勝手に混ざり、**AIDEの全道具（書き込みを
 *   含む）がどの経路のモデルにも見える。** 承認ポリシーで止まってはいたが、モデルがそちらを
 *   試して往復を無駄にする（実測）。`-c mcp_servers.codex_apps.enabled=false` は
 *   「invalid transport」で起動ごと落ちる
 * - **接続を付けるだけなら所要は伸びない**（付けない3.4〜4.0秒／付けて3.5〜3.9秒。`gpt-5.6-luna`）。
 *   伸びるのは道具を実際に呼んだ回だけ（＋約9秒＝モデルがもう1回考えるぶん）
 * - **落ちている接続先があっても相談は止まらない**（`startup_timeout_sec`。実測3.9秒で通常の返答）
 * - 道具の呼び出しは `item.started` / `item.completed`（`item.type === "mcp_tool_call"`）で届く。
 *   `arguments`・`result.content[].text`・`error.message`・`status` がそのまま載る
 */

const CODEX_BIN = process.env.CODEX_BIN ?? "codex";

/**
 * 接続先へ繋ぐまでの上限（秒）。落ちている接続先で相談ごと固まらないための値。
 * 同一VPS内のAIDEなら1秒かからない。
 */
const MCP_STARTUP_TIMEOUT_SEC = 10;

/** 道具1回の上限（秒）。AIDEの道具は数秒で返る。これを超える回は諦めて本文へ進ませる。 */
const MCP_TOOL_TIMEOUT_SEC = 30;

/**
 * Codexへ渡すリモートMCPサーバー1つぶん（#131）。
 *
 * `name` は `-c mcp_servers.<name>` のキーになるので、英小文字・数字・ハイフンだけ
 * （`McpConnection.slug` がその形で作られている）。
 */
export type CodexMcpServer = {
  name: string;
  url: string;
  accessToken: string;
  /** モデルに見せない道具の名前（#78の書き込みの道具）。 */
  disabledTools: string[];
};

/** 道具の呼び出し1回ぶんの出来事（#131）。`onToolCall` で呼び出し側へ渡す。 */
export type CodexToolCallEvent = {
  /** JSONLの `item.id`。始まりと終わりを突き合わせる鍵。 */
  id: string;
  /** `CodexMcpServer.name`。 */
  server: string;
  tool: string;
  /** モデルが渡した引数。 */
  arguments: unknown;
  status: "started" | "completed" | "failed";
  /** 接続先が返した内容（`content` のテキストを連結）。始まりの時点・失敗の回は`null`。 */
  resultText: string | null;
  /** 失敗の理由。成功の回は`null`。 */
  errorMessage: string | null;
};

/**
 * Codexの子プロセスへ渡してよい環境変数の名前（#258）。**許可リストで拾う。**
 *
 * 子プロセスへ `process.env` を丸ごと渡すと、本番では `next start` が読み込んだ `DATABASE_URL`・
 * `VAPID_PRIVATE_KEY`・`BRIEFING_TRIGGER_TOKEN`・`NOTICE_INGEST_TOKEN` などがそのまま入る。
 * `--sandbox read-only` はファイルや環境変数を**読む**ことを止めないので、モデルが `env` を
 * 実行すれば値が見える。モデルへ食わせる文字列は外から来る（`--search` のニュース・MCPの道具の
 * 結果）ため、プロンプトインジェクションが入るとシークレットが外へ出る筋が成り立つ。
 *
 * **ここに足すのは「Codexが自分で動くのに要るもの」だけ。** アプリの設定値（`DATABASE_URL` など）
 * や、他のアプリのシークレットは足さない。足りずに動かなくなったときは、値を足す前に
 * 「Codexのどの機能がそれを読むのか」を確かめる。
 *
 * - `PATH`・`HOME`・`USER`・`LOGNAME`・`SHELL`：実行ファイルの解決と、`~/.codex/auth.json`
 *   （ChatGPTの認証情報）の場所の解決。`CODEX_HOME` を置いていない環境では `HOME` が要る
 * - `CODEX_` で始まるもの：`CODEX_HOME`（認証情報の置き場）・`CODEX_CA_CERTIFICATE` など、
 *   Codex自身の設定。開発のスタブ（`scripts/codex-stub.sh`）が読む `CODEX_STUB_*` もここで通る。
 *   `CODEX_BIN`（アプリが読む起動コマンド）も入るが、実行ファイルの場所でありシークレットではない
 * - `XDG_*`：設定・キャッシュ・ランタイムの置き場（Linuxでの `HOME` 以外の解決先）
 * - `LANG`・`LC_*`・`TZ`・`TMPDIR`・`TERM`：ロケール・時刻・一時ファイル
 * - プロキシ（`HTTP_PROXY` など）・証明書（`SSL_CERT_*`・`NODE_EXTRA_CA_CERTS`）：ChatGPTへ
 *   出ていくための設定。プロキシのURLに資格情報が入る環境では、それも子へ渡ることになる
 *   （そうした環境でだけ効く。そうでなければ値そのものが無い）
 */
const CODEX_ENV_ALLOW_NAMES: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TZ",
  "TMPDIR",
  "TERM",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
]);

/** 前方一致で通す名前。 */
const CODEX_ENV_ALLOW_PREFIXES = ["CODEX_", "XDG_", "LC_"];

/** プロキシの設定は大文字・小文字の両方が使われる。 */
const CODEX_ENV_PROXY_NAMES = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];

function isCodexEnvAllowed(name: string): boolean {
  if (CODEX_ENV_ALLOW_NAMES.has(name)) return true;
  if (CODEX_ENV_ALLOW_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return CODEX_ENV_PROXY_NAMES.includes(name.toUpperCase());
}

/**
 * Codexの子プロセスへ渡す環境変数を組み立てる（#258）。許可リストに載っている名前だけを
 * `base`（既定は `process.env`）から拾い、`extra`（MCPのアクセストークン）を足す。
 *
 * `extra` は許可リストを通さない——呼び出し側（`mcpOverrides()`）が `AIDE_BOT_MCP_TOKEN_*` を
 * 自分で組み立てたもので、`base` から来る値ではない。
 */
export function codexChildEnv(
  base: Record<string, string | undefined>,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  // `spawn` の `env` は、Next.jsの型定義が `NODE_ENV` を必須にした `ProcessEnv`。子へ渡す値に
  // `NODE_ENV` は含めない（許可リストに無い）ので、型の上だけ合わせる。
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && isCodexEnvAllowed(name)) env[name] = value;
  }
  return { ...env, ...extra } as NodeJS.ProcessEnv;
}

/**
 * **モデルが実行するシェル**へ渡す環境の絞り込み（#258）。`codexChildEnv()` の絞り込みとは別の層。
 *
 * 子プロセスの環境を絞っても、Codexは自分が持っている環境をそのままモデルのシェルへ渡す。
 * 実測（サブPC・`codex-cli 0.152.1`・2026-09-19）で、`AIDE_BOT_MCP_TOKEN_*`（接続先へ繋ぐための
 * アクセストークン。Codex本体が `bearer_token_env_var` で読む）が、モデルが実行した `env` に
 * そのまま出た。**トークン名に `TOKEN` が入っていても既定の除外は効かなかった。**
 * また、ログインシェルが読み込む利用者のプロファイルが足す変数（`OP_SERVICE_ACCOUNT_TOKEN` など）も
 * 出た。**そこはアプリの `process.env` ではないので、`codexChildEnv()` では塞げない。**
 *
 * - `shell_environment_policy.inherit="core"`：`PATH`・`HOME` などの最小限だけを渡す。
 *   MCPのトークンはCodex本体が読むもので、モデルのシェルには要らない（この設定でも接続先へ
 *   繋がる。下の実測）
 * - `allow_login_shell=false`：利用者のシェルのプロファイル（`~/.profile` など）を読ませない
 */
const CODEX_SHELL_POLICY_ARGS = [
  "-c",
  'shell_environment_policy.inherit="core"',
  "-c",
  "allow_login_shell=false",
];

/** アクセストークンを載せる環境変数の名前。引数にも設定ファイルにも出さないため。 */
function tokenEnvVar(name: string): string {
  return `AIDE_BOT_MCP_TOKEN_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

/**
 * `-c mcp_servers.<名前>.…` の並びと、トークンを載せる環境変数を組み立てる。
 *
 * 値はTOMLとして読まれる。文字列はJSONの文字列リテラルと同じ書き方で通る（URLと英数字しか
 * 入れない前提）。
 */
function mcpOverrides(servers: CodexMcpServer[]): { args: string[]; env: Record<string, string> } {
  const args: string[] = [];
  const env: Record<string, string> = {};

  for (const server of servers) {
    const key = `mcp_servers.${server.name}`;
    const envVar = tokenEnvVar(server.name);
    env[envVar] = server.accessToken;

    args.push(
      "-c", `${key}.url=${JSON.stringify(server.url)}`,
      "-c", `${key}.bearer_token_env_var=${JSON.stringify(envVar)}`,
      "-c", `${key}.default_tools_approval_mode="approve"`,
      // 複数の道具が要る問いを1回でまとめて呼ばせる。順に呼ぶと道具の数だけ往復が増える。
      "-c", `${key}.supports_parallel_tool_calls=true`,
      "-c", `${key}.startup_timeout_sec=${MCP_STARTUP_TIMEOUT_SEC}`,
      "-c", `${key}.tool_timeout_sec=${MCP_TOOL_TIMEOUT_SEC}`,
    );

    if (server.disabledTools.length > 0) {
      args.push("-c", `${key}.disabled_tools=${JSON.stringify(server.disabledTools)}`);
    }
  }

  return { args, env };
}

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
   * 利用者へ返す本文（#131）。**道具を呼んだ回は、最後の道具より後ろに届いた `agent_message` だけ。**
   *
   * 道具を呼ぶ前に「確認します」のような前置きが別の `agent_message` として先に届く（`--search` と
   * 同じ形）。`text` はそれも連結するので、相談の返答に混ぜると道具の名前が本文に出たり、
   * 読み上げが前置きから始まったりする。道具を呼ばなかった回は `text` と同じ。
   */
  reply: string;
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

/** 中断で終わった回の結果。起動前に中断されていた回（#259）と、実行中に打ち切った回で同じ形を返す。 */
function interruptedResult(): CodexResult {
  return { text: "", reply: "", messages: [], interrupted: true, errorMessage: null, usage: null };
}

/** `codex exec --json` が出すJSONLの1行。実際に使う項目だけを緩く宣言する。 */
type CodexEvent = {
  type: string;
  item?: {
    id?: string;
    type?: string;
    text?: string;
    // `mcp_tool_call` のとき（#131）。
    server?: string;
    tool?: string;
    arguments?: unknown;
    result?: { content?: { type?: string; text?: string }[] } | null;
    error?: { message?: string } | null;
    status?: string;
  };
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
 * - **プロンプトは引数ではなく標準入力で渡す（#244）。** 引数は `-` にして `child.stdin` へ
 *   書く（`codex exec --help` の「`-` なら標準入力から読む」）。引数で渡すとLinuxの1本あたりの
 *   上限（`MAX_ARG_STRLEN`＝128KiB。日本語はUTF-8で3バイトなので約4.3万文字）を超えた時点で
 *   `spawn` が同期で `E2BIG` を投げ、相談もcompactも同じ会話で失敗し続ける。会話の本文が
 *   `ps` に見えてしまうのも避けられる。**引数に本文を残したまま標準入力もパイプすると
 *   「Reading additional input from stdin...」の案内とともに標準入力が `<stdin>` ブロックとして
 *   追記される**ので、引数は必ず `-` にする
 * - `search` を立てると `--search`（ウェブ検索）を付ける（#144）。**このフラグは `exec` の
 *   サブコマンドではなく `codex` 本体の引数**なので、`exec` より前に置く（`codex exec --help`
 *   には出ず、`codex --help` にだけ出る）。読み取り専用のサンドボックスと両立する（実測）
 * - `mcpServers` を渡すと、その接続を `-c mcp_servers.…` で付ける（#131。上のモジュールコメント）。
 *   道具の呼び出しは届いた端から `onToolCall` へ渡す——本文は完了時にしか届かないので、
 *   「いま調べています」を画面に出せるのはこの経路だけ
 * - `features.apps=false` は接続の有無によらず常に付ける（上のモジュールコメント）
 */
export async function runCodexExec(params: {
  model: string;
  prompt: string;
  signal: AbortSignal;
  search?: boolean;
  mcpServers?: CodexMcpServer[];
  onToolCall?: (event: CodexToolCallEvent) => void;
}): Promise<CodexResult> {
  const { model, prompt, signal, search = false, mcpServers = [], onToolCall } = params;

  // 呼ばれる前にすでに中断されていたら、起動しない（#259）。`abort` イベントは中断の瞬間に
  // 一度だけ発火し、後から付けたリスナーには届かない。`/api/chat` はここへ来るまでに
  // 発言の保存・接続の読み出しなどを待つので、その間に割り込まれると、下の `onAbort` は
  // 二度と呼ばれず、打ち切ったはずの生成が最後まで走って利用枠を使い、返答が
  // `interrupted: false` で保存される。
  if (signal.aborted) return interruptedResult();

  const mcp = mcpOverrides(mcpServers);

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
        "-c",
        "features.apps=false",
        // モデルのシェルへ渡す環境を最小に絞る（#258。下の `CODEX_SHELL_POLICY_ARGS`）。
        ...CODEX_SHELL_POLICY_ARGS,
        ...mcp.args,
        "-C",
        tmpdir(),
        // 本文は標準入力から渡す（上のコメント）。
        "-",
      ],
      // トークンも本文も、引数に載せると `ps` や起動ログに出る。環境変数・標準入力で渡す。
      // **環境変数は `process.env` を丸ごと渡さず、許可リストで絞る**（#258。`codexChildEnv()`）。
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: codexChildEnv(process.env, mcp.env),
      },
    );

    // 子が入力を読み切る前に終わる（起動失敗・中断）と、書き込みが `EPIPE` で落ちる。
    // 握りつぶさないとプロセスごと未処理の例外で落ちる。失敗は `error` / `close` 側で扱う。
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);

    let text = "";
    const messages: string[] = [];
    // 最後の道具より後ろに届いた本文（`reply`）。道具が完了するたびに空にする。
    let replyParts: string[] = [];
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
          replyParts.push(event.item.text ?? "");
        } else if (
          (event.type === "item.started" || event.type === "item.completed") &&
          event.item?.type === "mcp_tool_call"
        ) {
          const item = event.item;
          const completed = event.type === "item.completed";
          if (completed) replyParts = [];

          onToolCall?.({
            id: item.id ?? "",
            server: item.server ?? "",
            tool: item.tool ?? "",
            arguments: item.arguments,
            status: !completed ? "started" : item.status === "completed" ? "completed" : "failed",
            resultText: completed ? toolResultText(item.result) : null,
            errorMessage: completed ? (item.error?.message ?? null) : null,
          });
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
        reply: "",
        messages: [],
        interrupted: false,
        errorMessage: "返答の生成に必要な設定がサーバー側にありません。管理者に連絡してください。",
        usage: null,
      });
    });

    child.on("close", (code) => {
      if (interrupted) {
        finish(interruptedResult());
        return;
      }

      if (code !== 0 && !errorMessage) {
        console.error("[aide-bot] codex exec が非0で終了した", { code, stderrLog });
        errorMessage = "返答の生成に失敗しました。少し待ってからもう一度お試しください。";
      }

      finish({ text, reply: replyParts.join(""), messages, interrupted: false, errorMessage, usage });
    });
  });
}

/** `mcp_tool_call` の `result` を、そのまま残せる文字列に均す。`content` が無ければ`null`。 */
function toolResultText(result: NonNullable<CodexEvent["item"]>["result"]): string | null {
  if (!result?.content) return null;

  return result.content
    .filter((block) => typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
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
