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
  /**
   * `slug` としてそのまま使う。英小文字・数字・ハイフンのみ。Codexの `-c mcp_servers.<slug>` の
   * キー（TOMLのベアキー）にもなる（#131）。
   */
  id: string;
  label: string;
  url: string;
  /** 画面に出す一行の説明。何が引けるようになるかを書く。 */
  description: string;
  /**
   * この接続先が持つ、**書き込みを伴う道具**の名前（#78）。
   *
   * 既定ではこれらを秘書へ渡さない。絞り込みは**ここに挙げた名前を名指しで止める形**
   * （相談はCodexの `disabled_tools`、朝の見通しは `mcp_toolset` の `configs`。#131）なので、
   * **挙げ漏らした道具はそのまま渡る。**
   * 接続先が書き込みの道具を増やしたら、ここへ足すまで絞り込みは効かない。
   *
   * 逆向き（取得系だけを名指しで許す）にしないのは、接続先が取得系を1つ足すたびに
   * こちらを直すまでその道具が使えなくなるため。**取りこぼしても壊れない側**へ倒してある。
   */
  writeTools: string[];
};

export const MCP_PRESETS: McpPreset[] = [
  {
    id: "aide",
    label: "AIDE",
    url: "https://aide.gucchii.com/mcp",
    description: "資産と固定費・部屋の状態・VPSとサブPCの稼働・今日の見通し・開発状況",
    // `guchi-apps/aide` の `src/mcp/tools/zaim.ts` / `src/mcp/tools/issue.ts`。
    // `aide_zaim_payment` は説明文に「この経路から取り消し・修正はできない」と明記されている。
    writeTools: ["aide_zaim_payment", "aide_create_issue"],
  },
  {
    id: "notion",
    label: "Notion",
    url: "https://mcp.notion.com/mcp",
    description: "Notionのページとデータベースの検索・閲覧・編集",
    // **あえて空にしてある**（#78）。名前が違えばその道具は素通りするだけだが、
    // 逆に接続先が改名した名前を書いたまま残すと、相談のたびに実在しない道具を
    // 名指しすることになる。手元にAPIキーが無く実物で確かめられないため、
    // 確かめられた接続先（AIDE）から埋める。Notionの書き込みはゴミ箱と履歴から戻せる。
    writeTools: [],
  },
];

export function findPreset(url: string): McpPreset | undefined {
  return MCP_PRESETS.find((preset) => preset.url === url);
}

/**
 * その接続先の書き込みの道具を返す（#78）。
 *
 * プリセットに無い接続先（利用者が自分でURLを入れて繋いだもの）では空になる。
 * **空は「書き込みの道具が無い」ではなく「把握していない」**という意味で、設定の画面は
 * そのことをそのまま出す。
 */
export function writeToolsFor(url: string): string[] {
  return findPreset(url)?.writeTools ?? [];
}
