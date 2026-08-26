import { cookies } from "next/headers";

import {
  WRITE_TOOL_POLICY_COOKIE,
  normalizeWriteToolPolicy,
  type WriteToolPolicy,
} from "@/lib/mcp/write-tools";

/**
 * この端末が選んでいる、書き込みの道具の扱いをCookieから読む（#78）。
 *
 * **サーバー専用。** `next/headers` はクライアント側のビルドに入れられないため、
 * 設定の定義（`@/lib/mcp/write-tools`）とは別のファイルへ分けてある
 * （返答のモデル #71 と同じ分け方）。
 */
export async function selectedWriteToolPolicy(): Promise<WriteToolPolicy> {
  const store = await cookies();

  return normalizeWriteToolPolicy(store.get(WRITE_TOOL_POLICY_COOKIE)?.value);
}
