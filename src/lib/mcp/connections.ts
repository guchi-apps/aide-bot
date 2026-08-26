import type Anthropic from "@anthropic-ai/sdk";
import type { McpConnection } from "@prisma/client";

import { db } from "@/lib/db";
import {
  McpOAuthError,
  buildAuthorizeUrl,
  createPkcePair,
  createState,
  discoverEndpoints,
  exchangeCode,
  refreshTokens,
  registerClient,
} from "@/lib/mcp/oauth";
import { findPreset, writeToolsFor } from "@/lib/mcp/presets";

/**
 * 外部サービスとの接続の出し入れ（#46）。
 *
 * 画面・Route Handler・`/api/chat` の3か所から使うため、DBの触り方とトークンの更新は
 * ここへ集約する。**トークンそのものを画面側へ返さない**のもここの責務で、一覧に使う型は
 * `ConnectionView` に絞ってある。
 */

/** 認可のコールバックを受ける場所。相手の認可サーバーにもこのURLで登録する。 */
export const CONNECTION_CALLBACK_PATH = "/api/connections/callback";

/** 期限のこれだけ手前になったら先に更新する。相談の最中に切れるのを避けるため。 */
const REFRESH_MARGIN_MS = 60_000;

export type ConnectionView = {
  id: string;
  label: string;
  slug: string;
  url: string;
  enabled: boolean;
  /** トークンを持っていて、いま使える状態か。 */
  connected: boolean;
};

export type ConnectedServer = {
  slug: string;
  label: string;
  url: string;
  accessToken: string;
};

function toView(connection: McpConnection): ConnectionView {
  return {
    id: connection.id,
    label: connection.label,
    slug: connection.slug,
    url: connection.url,
    enabled: connection.enabled,
    connected: connection.accessToken !== null,
  };
}

export async function listConnections(userId: string): Promise<ConnectionView[]> {
  const connections = await db.mcpConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });

  return connections.map(toView);
}

/**
 * 入力されたURLを検証する。
 *
 * `https` に限っているのは、MCPコネクタ側が `https://` で始まるURLしか受け付けないため
 * （平文のURLを保存しても、相談のときに必ず弾かれる）。
 */
export function normalizeMcpUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new McpOAuthError("URLの形式が正しくありません。");
  }

  if (url.protocol !== "https:") {
    throw new McpOAuthError("MCPサーバーのURLは https で始まる必要があります。");
  }

  url.hash = "";
  return url.toString();
}

/** Messages APIへ渡すサーバー名を作る。英小文字・数字・ハイフンだけに落とす。 */
function baseSlug(url: string, label: string): string {
  const source = findPreset(url)?.id ?? label ?? new URL(url).hostname;
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);

  return slug === "" ? "mcp" : slug;
}

async function uniqueSlug(userId: string, url: string, label: string): Promise<string> {
  const base = baseSlug(url, label);

  for (let suffix = 0; suffix < 50; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const taken = await db.mcpConnection.findUnique({
      where: { userId_slug: { userId, slug: candidate } },
      select: { id: true },
    });
    if (!taken) return candidate;
  }

  // 実際には到達しない。到達したら重複しない値を作って通す。
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * 接続を作り（すでにあれば繋ぎ直し）、認可画面のURLを返す。
 *
 * ディスカバリとクライアント登録はここで済ませ、結果を行へ持たせる。認可から戻ってきた
 * ときに引き直すと、相手のメタデータが一時的に引けないだけで接続が完了しなくなる。
 */
export async function startConnection(params: {
  userId: string;
  url: string;
  label: string;
  origin: string;
}): Promise<string> {
  const url = normalizeMcpUrl(params.url);
  const label = params.label.trim() || findPreset(url)?.label || new URL(url).hostname;
  const redirectUri = `${params.origin}${CONNECTION_CALLBACK_PATH}`;

  const endpoints = await discoverEndpoints(url);
  if (!endpoints.registrationEndpoint) {
    throw new McpOAuthError(
      "この認可サーバーはクライアントの自動登録に対応していないため、ここからは繋げません。",
    );
  }

  const client = await registerClient(endpoints.registrationEndpoint, redirectUri);
  const { verifier, challenge } = createPkcePair();
  const state = createState();

  // 同じURLへの繋ぎ直しは行を増やさず上書きする。増やすと同じサービスが二重に並ぶ。
  const existing = await db.mcpConnection.findFirst({ where: { userId: params.userId, url } });
  const slug = existing?.slug ?? (await uniqueSlug(params.userId, url, label));

  const data = {
    label: label.slice(0, 60),
    slug,
    url,
    authorizationEndpoint: endpoints.authorizationEndpoint,
    tokenEndpoint: endpoints.tokenEndpoint,
    clientId: client.clientId,
    clientSecret: client.clientSecret,
    pendingState: state,
    pendingVerifier: verifier,
    pendingRedirectUri: redirectUri,
  };

  if (existing) {
    await db.mcpConnection.update({ where: { id: existing.id }, data });
  } else {
    await db.mcpConnection.create({ data: { ...data, userId: params.userId } });
  }

  return buildAuthorizeUrl({
    authorizationEndpoint: endpoints.authorizationEndpoint,
    clientId: client.clientId,
    redirectUri,
    state,
    challenge,
    resource: url,
  });
}

/**
 * 認可コードを受け取ってトークンを保存する。
 *
 * `state` はDBに保存した値と突き合わせる。当たった行の利用者しか繋がらないので、
 * 他人のコールバックで書き換えられることはない。
 */
export async function completeConnection(params: {
  state: string;
  code: string;
}): Promise<{ label: string }> {
  const connection = await db.mcpConnection.findFirst({
    where: { pendingState: params.state },
  });

  if (!connection || !connection.tokenEndpoint || !connection.clientId || !connection.pendingVerifier) {
    throw new McpOAuthError("認可の途中経過が見つかりませんでした。もう一度やり直してください。");
  }

  const tokens = await exchangeCode({
    tokenEndpoint: connection.tokenEndpoint,
    clientId: connection.clientId,
    clientSecret: connection.clientSecret,
    code: params.code,
    redirectUri: connection.pendingRedirectUri ?? "",
    verifier: connection.pendingVerifier,
    resource: connection.url,
  });

  await db.mcpConnection.update({
    where: { id: connection.id },
    data: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      enabled: true,
      pendingState: null,
      pendingVerifier: null,
      pendingRedirectUri: null,
    },
  });

  return { label: connection.label };
}

export async function setConnectionEnabled(userId: string, id: string, enabled: boolean) {
  await db.mcpConnection.updateMany({ where: { id, userId }, data: { enabled } });
}

export async function deleteConnection(userId: string, id: string) {
  await db.mcpConnection.deleteMany({ where: { id, userId } });
}

/**
 * 期限が近ければトークンを更新して返す。更新できなければnull。
 *
 * **更新の応答にリフレッシュトークンが無い場合は、いま持っているものを使い続ける。**
 * 仕様上、返さない実装があり、消してしまうと次の更新ができなくなる。
 */
async function usableToken(connection: McpConnection): Promise<string | null> {
  if (!connection.accessToken) return null;

  const expiresSoon =
    connection.expiresAt !== null &&
    connection.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;

  if (!expiresSoon) return connection.accessToken;
  if (!connection.refreshToken || !connection.tokenEndpoint || !connection.clientId) return null;

  try {
    const tokens = await refreshTokens({
      tokenEndpoint: connection.tokenEndpoint,
      clientId: connection.clientId,
      clientSecret: connection.clientSecret,
      refreshToken: connection.refreshToken,
      resource: connection.url,
    });

    await db.mcpConnection.update({
      where: { id: connection.id },
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? connection.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    return tokens.accessToken;
  } catch (error) {
    // 1件の更新に失敗しても相談そのものは通す。繋がっていない状態で答えるほうが、
    // 秘書が黙り込むより実害が小さい。
    console.error(`[aide-bot] MCP接続のトークン更新に失敗した: ${connection.label}`, error);
    return null;
  }
}

/** いま使える接続を返す。相談1往復ごとにこれを呼ぶ。 */
export async function listConnectedServers(userId: string): Promise<ConnectedServer[]> {
  const connections = await db.mcpConnection.findMany({
    where: { userId, enabled: true, accessToken: { not: null } },
    orderBy: { createdAt: "asc" },
  });

  const servers: ConnectedServer[] = [];

  for (const connection of connections) {
    const accessToken = await usableToken(connection);
    if (!accessToken) continue;

    servers.push({
      slug: connection.slug,
      label: connection.label,
      url: connection.url,
      accessToken,
    });
  }

  return servers;
}

/**
 * Messages APIへ渡す2点セットを組み立てる。
 *
 * **`mcp_servers` だけでは400になる。** サーバーの定義と、それを指す `mcp_toolset` が
 * `tools` 側にも要る（1サーバーにつきちょうど1つ）。
 *
 * `allowWriteTools` が偽のときは、把握している書き込みの道具を `configs` で止める（#78）。
 * **`mcp-client-2025-11-20` に `allowed_tools` は無い。** 絞り込みは
 * 「既定は全部有効（`default_config`）＋道具ごとの上書き（`configs`）」という形で、
 * 名指しした道具だけを `enabled: false` にできる。挙げ漏らした道具はそのまま渡る。
 *
 * 止めた道具の名前は `withheldTools` で返す。システムプロンプト側で「いまは書き込みの
 * 道具が渡っていない」と伝えるのに使う——伝えないと、渡っていないことに気付かないまま
 * 「登録しておきました」と答えてしまう。
 */
export function toMcpRequestParts(
  servers: ConnectedServer[],
  allowWriteTools: boolean,
): {
  mcpServers: Anthropic.Beta.BetaRequestMCPServerURLDefinition[];
  tools: Anthropic.Beta.BetaMCPToolset[];
  withheldTools: string[];
} {
  const withheldTools: string[] = [];

  const tools = servers.map((server) => {
    // 並びは `MCP_PRESETS` の記述順のまま。プロンプトキャッシュは `tools` を含む前方一致で
    // 効くため、往復ごとにキーの順が変わると、そこから後ろが全部書き直しになる（#56）。
    const withheld = allowWriteTools ? [] : writeToolsFor(server.url);
    withheldTools.push(...withheld);

    return {
      type: "mcp_toolset" as const,
      mcp_server_name: server.slug,
      ...(withheld.length > 0
        ? {
            configs: Object.fromEntries(
              withheld.map((name) => [name, { enabled: false }] as const),
            ),
          }
        : {}),
    };
  });

  return {
    mcpServers: servers.map((server) => ({
      type: "url" as const,
      name: server.slug,
      url: server.url,
      authorization_token: server.accessToken,
    })),
    tools,
    withheldTools,
  };
}
