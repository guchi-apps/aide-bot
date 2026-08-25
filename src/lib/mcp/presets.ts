/**
 * 接続画面に並べる既定の接続先（#46）。
 *
 * **ここへ足してよいのは「公式のリモートMCPサーバーが公開されているもの」だけ。**
 * 公開されていないサービス（Googleカレンダー・Gmailなど）は、Claudeアプリのコネクタが
 * Anthropic製品側の機能で、Messages APIから叩けるURLが存在しない。その手の接続先は
 * AIDE（`guchi-apps/aide`）側にコネクタとMCPツールを足し、AIDEの1接続にまとめる
 * ——AIDEの「公式MCPと重複するツールをMCP層に出さない」方針と表裏になっている。
 */

export type McpPreset = {
  /** `slug` としてそのまま使う。英小文字・数字・ハイフンのみ。 */
  id: string;
  label: string;
  url: string;
  /** 画面に出す一行の説明。何が引けるようになるかを書く。 */
  description: string;
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "aide",
    label: "AIDE",
    url: "https://aide.gucchii.com/mcp",
    description: "資産と固定費・部屋の状態・VPSとサブPCの稼働・今日の見通し・開発状況",
  },
  {
    id: "notion",
    label: "Notion",
    url: "https://mcp.notion.com/mcp",
    description: "Notionのページとデータベースの検索・閲覧・編集",
  },
];

export function findPreset(url: string): McpPreset | undefined {
  return MCP_PRESETS.find((preset) => preset.url === url);
}
