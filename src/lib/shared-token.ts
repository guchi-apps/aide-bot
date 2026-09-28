/**
 * issue-deckの共有トークンAPI（guchi-apps/issue-deck の `docs/shared-token-api.md`）から、
 * 他アプリと共有する認証値を実行時に読む（#403）。1Passwordから各アプリへ複製せず、
 * issue-deckを唯一の正にする「方式A」。形はops-dashboardの `src/lib/shared-token.ts` に揃えてある。
 *
 * `SHARED_TOKEN_API_SECRET`・`ISSUE_DECK_URL` のどちらかが無い環境（手元・移行前）では取りに行かず、
 * 呼び出し元が今までの環境変数へフォールバックする。**値もBearerも、ログ・レスポンスには出さない**
 * （失敗のログはトークン名とHTTPステータスまで）。
 */

export const SHARED_TOKEN_CONSUMER = "aide-bot";

const CACHE_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5_000;

export interface SharedTokenCacheEntry {
  value: string;
  fetchedAtMs: number;
}

export interface SharedTokenResult {
  /**
   * 1. キャッシュが新しければそれ
   * 2. issue-deckから取れればそれ
   * 3. 取れなかった・未設定なら、古くても直前のキャッシュ値
   * 4. どれも無ければ null（呼び出し側が環境変数へフォールバックする）
   */
  value: string | null;
  /** 呼び出し元が次回へ引き継ぐキャッシュ。取得に失敗しても直前の値を保つ */
  cache: SharedTokenCacheEntry | null;
}

export interface SharedTokenEnv {
  baseUrl?: string;
  secret?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 副作用（キャッシュの保持）を関数の外へ出してあり、テストからは `fetchImpl` を差し替えられる。 */
export async function resolveSharedToken(
  name: string,
  previous: SharedTokenCacheEntry | null,
  options: { now?: number; env?: SharedTokenEnv; fetchImpl?: typeof fetch } = {},
): Promise<SharedTokenResult> {
  const now = options.now ?? Date.now();

  if (previous && now - previous.fetchedAtMs < CACHE_MS) {
    return { value: previous.value, cache: previous };
  }

  const baseUrl = options.env?.baseUrl ?? process.env.ISSUE_DECK_URL;
  const secret = options.env?.secret ?? process.env.SHARED_TOKEN_API_SECRET;
  if (!baseUrl || !secret) {
    return { value: previous?.value ?? null, cache: previous };
  }

  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/api/shared-tokens?name=${encodeURIComponent(name)}`;
    const response = await (options.fetchImpl ?? fetch)(url, {
      headers: {
        authorization: `Bearer ${secret}`,
        "x-shared-token-consumer": SHARED_TOKEN_CONSUMER,
        accept: "application/json",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.value !== "string" || payload.value === "") {
      throw new SyntaxError("unexpected payload");
    }

    return { value: payload.value, cache: { value: payload.value, fetchedAtMs: now } };
  } catch (error) {
    // 例外の文言にURLやヘッダーは入らないが、念のためメッセージだけを出す。
    console.error(`[aide-bot] 共有トークンの取得に失敗した（${name}）`, error instanceof Error ? error.message : "不明なエラー");
    return { value: previous?.value ?? null, cache: previous };
  }
}

const caches = new Map<string, SharedTokenCacheEntry>();

/**
 * 共有トークンの値を返す。取れなければ `fallback`（今までの環境変数）。どちらも無ければ undefined。
 * **フォールバックに落ちた回はログに残す**（画面上は正常に見えるため、issue-deckの利用元表示と
 * 合わせて気付けるようにする）。
 */
export async function sharedTokenOrEnv(name: string, fallback: string | undefined): Promise<string | undefined> {
  const result = await resolveSharedToken(name, caches.get(name) ?? null);
  if (result.cache) caches.set(name, result.cache);
  if (result.value) return result.value;

  if (process.env.ISSUE_DECK_URL && process.env.SHARED_TOKEN_API_SECRET) {
    console.warn(`[aide-bot] 共有トークン（${name}）を取れず、環境変数へフォールバックした`);
  }
  return fallback;
}
