import { createHash, randomBytes } from "node:crypto";

/**
 * リモートMCPサーバーへ繋ぐためのOAuth 2.1クライアント（#46）。
 *
 * MCPの認可はディスカバリ（RFC 9728 / RFC 8414）＋動的クライアント登録（RFC 7591）＋
 * PKCEの組み合わせで、必要なのは「認可URLの組み立て」と「コードの交換」だけ。
 * **専用のライブラリは入れていない**——`fetch` と `node:crypto` で足り、依存を増やすと
 * ビルド時間とVPSのメモリにそのまま効くため。
 *
 * 相手が落ちているときに画面ごと固まらないよう、外向きのリクエストには必ず期限を付ける。
 */

const REQUEST_TIMEOUT_MS = 10_000;

/** aide-bot が動的クライアント登録で名乗る名前。相手の認可画面にこの名前が出る。 */
const CLIENT_NAME = "aide-bot（秘書アプリ）";

export type DiscoveredEndpoints = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
};

export type RegisteredClient = {
  clientId: string;
  clientSecret: string | null;
};

export type IssuedTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** 期限が返らなかった場合はnull。その場合は期限切れの判定をせず、401で気付く。 */
  expiresAt: Date | null;
};

/** 相手のサーバーが返した文言をそのまま画面へ出すためのエラー。 */
export class McpOAuthError extends Error {}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text === "" ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = record(parsed);
    const description = str(detail, "error_description") ?? str(detail, "error");
    throw new McpOAuthError(
      description ?? `${url} が ${response.status} を返しました`,
    );
  }

  return parsed;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function str(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * `.well-known` を試す順番を組み立てる。
 *
 * RFC 9728 / RFC 8414 は「パスをwell-knownの**後ろ**へ差し込む」形を定めている
 * （`https://example.com/mcp` → `https://example.com/.well-known/oauth-protected-resource/mcp`）。
 * ただし実装によってはパス無しでしか出していないため、両方を順に試す。
 */
function wellKnownCandidates(base: URL, name: string): string[] {
  const path = base.pathname.replace(/\/$/, "");
  const candidates = [`${base.origin}/.well-known/${name}`];
  if (path !== "") candidates.unshift(`${base.origin}/.well-known/${name}${path}`);
  return candidates;
}

async function fetchFirst(urls: string[]): Promise<Record<string, unknown> | null> {
  for (const url of urls) {
    try {
      const found = record(await fetchJson(url));
      if (found) return found;
    } catch {
      // 次の候補を試す。全滅した場合だけ呼び出し側でエラーにする。
    }
  }
  return null;
}

/**
 * MCPサーバーのURLから認可サーバーのエンドポイントを引く。
 *
 * 保護リソースのメタデータ（`authorization_servers`）を先に見るのは、認可サーバーが
 * MCPサーバーと別ホストに置かれている場合があるため。引けなければMCPサーバー自身を
 * 認可サーバーとみなす（AIDEのように1プロセスで兼ねている構成がこれ）。
 */
export async function discoverEndpoints(mcpUrl: string): Promise<DiscoveredEndpoints> {
  const resource = new URL(mcpUrl);

  const protectedResource = await fetchFirst(
    wellKnownCandidates(resource, "oauth-protected-resource"),
  );
  const servers = protectedResource?.["authorization_servers"];
  const issuer =
    Array.isArray(servers) && typeof servers[0] === "string" ? servers[0] : resource.origin;

  const issuerUrl = new URL(issuer);
  const metadata = await fetchFirst([
    ...wellKnownCandidates(issuerUrl, "oauth-authorization-server"),
    ...wellKnownCandidates(issuerUrl, "openid-configuration"),
  ]);

  const authorizationEndpoint = str(metadata, "authorization_endpoint");
  const tokenEndpoint = str(metadata, "token_endpoint");

  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new McpOAuthError(
      "このURLの認可サーバーが見つかりませんでした。MCPサーバーのURL（末尾が /mcp など）になっているか確認してください。",
    );
  }

  return {
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint: str(metadata, "registration_endpoint"),
  };
}

/**
 * 動的クライアント登録。aide-bot を「公開クライアント」として登録する。
 *
 * クライアントシークレットを持たない（`token_endpoint_auth_method: "none"`）のは、
 * ブラウザからの認可を前提にしたPKCE前提のフローだから。相手がそれでもシークレットを
 * 返してきた場合は保存して、トークン要求に添える。
 */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
): Promise<RegisteredClient> {
  const registered = record(
    await fetchJson(registrationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    }),
  );

  const clientId = str(registered, "client_id");
  if (!clientId) {
    throw new McpOAuthError("クライアント登録の応答に client_id がありませんでした。");
  }

  return { clientId, clientSecret: str(registered, "client_secret") };
}

export type PkcePair = { verifier: string; challenge: string };

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * 認可画面のURLを組み立てる。
 *
 * `resource` を付けるのはMCPの認可仕様（RFC 8707）で、どのMCPサーバー向けのトークンかを
 * 認可サーバーへ伝える。付けないと、複数のリソースを持つ認可サーバーで発行を断られる。
 */
export function buildAuthorizeUrl(params: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  resource: string;
}): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", params.resource);
  return url.toString();
}

function toTokens(payload: Record<string, unknown> | null): IssuedTokens {
  const accessToken = str(payload, "access_token");
  if (!accessToken) {
    throw new McpOAuthError("トークンの応答に access_token がありませんでした。");
  }

  const expiresIn = payload?.["expires_in"];
  const expiresAt =
    typeof expiresIn === "number" && Number.isFinite(expiresIn)
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

  return { accessToken, refreshToken: str(payload, "refresh_token"), expiresAt };
}

async function postToken(
  tokenEndpoint: string,
  body: URLSearchParams,
  clientSecret: string | null,
): Promise<IssuedTokens> {
  if (clientSecret) body.set("client_secret", clientSecret);

  return toTokens(
    record(
      await fetchJson(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      }),
    ),
  );
}

export async function exchangeCode(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  redirectUri: string;
  verifier: string;
  resource: string;
}): Promise<IssuedTokens> {
  return postToken(
    params.tokenEndpoint,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: params.redirectUri,
      client_id: params.clientId,
      code_verifier: params.verifier,
      resource: params.resource,
    }),
    params.clientSecret,
  );
}

export async function refreshTokens(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
  resource: string;
}): Promise<IssuedTokens> {
  return postToken(
    params.tokenEndpoint,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
      client_id: params.clientId,
      resource: params.resource,
    }),
    params.clientSecret,
  );
}
