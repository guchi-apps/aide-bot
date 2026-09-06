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
   * この接続で秘書に**聞けること**（#167）。設定の画面の接続の行に並べる。
   *
   * 「部屋の温度は取れているのに、天気を聞くと場所を聞き返される」——何が連携できていて
   * 何ができていないのかが画面から分からない、というのがこの一覧を足した理由。
   *
   * **手で保つ一覧で、接続先の道具そのものではない。** 接続先が道具を増減しても自動では
   * 追随しないので、繋ぎ先を触ったときはここも見直す。
   */
  provides: string[];
  /**
   * この接続では**まだ取れないもの**（#167）。空なら画面に出さない。
   *
   * 取れないことを黙っていると、繋いだのに答えられない理由がアプリ側の不具合に見える。
   */
  missing: string[];
  /**
   * この接続を繋いでいるときだけ相談のシステムプロンプトへ足す指示（#184）。
   *
   * 道具の説明文だけでも呼び分けはできるが、**どの道具に何を渡せば問いに答えられるか**
   * （予定なら日付と日数、時刻は読み替えない）までは説明文に頼りきれない。接続先ごとの
   * 癖はここに置き、`connectedServiceRules()` が繋いでいる接続のぶんだけ並べる。
   * 繋いでいない接続の指示を出すと、無い道具を探して往復を無駄にする。
   *
   * **道具の名前を書くのは、その道具が接続先に実在すると確かめてから。** 無い名前を
   * 指示に書くと、モデルはそれを探してから諦める。
   */
  hints: string[];
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
    provides: [
      "いまの室温・湿度・CO2・エアコンの状態（aide_room_status）",
      "今日と明日の予定・天気（aide_daily_briefing）。天気は自宅の地域のもの",
      // Googleカレンダーへは直接繋がない。DaySpanが統合したものをAIDEが読む（aide#173）。
      "予定と空いている時間帯（aide_schedule）。今日から最大14日ぶんで、Googleカレンダーの予定に" +
        "Notionのタスク・日付リマインド・移動が混ざったもの",
      "資産と固定費・引き落とし予定（aide_money_summary）",
      "VPSとサブPCの稼働（aide_ops_status）・開発状況（aide_dev_status）",
      "放置しているClaudeのセッション（aide_claude_sessions）",
      // DaySpan（dayspan#550）→ AIDE（aide#243）の順に口が作られ、#185でaide-bot側も配線した。
      "予定の登録（aide_create_event）。GoogleカレンダーへDaySpan経由で1件作成する",
    ],
    missing: [
      "電車の遅延・乗換（交通のコネクタが未実装。guchi-apps/aide#33）",
      "今日・明日より先の天気、自宅以外の地域の天気",
      // guchi-apps/aide#243の時点では新規作成のみ。既存予定の更新・削除に当たる道具は無い。
      "予定の変更・取り消し（登録は aide_create_event でできる。入れ直しは DaySpan から）",
    ],
    hints: [
      // `aide_schedule` の説明文には「今日の予定は」で呼ぶとあり、`aide_daily_briefing` にも
      // 同じ聞き方が書いてある。どちらを呼ぶかを聞き方ではなく欲しいもので決めさせる。
      "予定・空いている時間・何時なら入れられるかを聞かれたら aide_schedule を呼ぶ。起点の日付（date）と日数（days）を、今日の日付から数えて YYYY-MM-DD で渡す。今日の見通し全体（予定に加えて天気・交通）が欲しいときだけ aide_daily_briefing を呼ぶ",
      "aide_schedule が返す時刻は日本時間の HH:MM なので、時差を足し引きせずそのまま伝える。configured や complete が false のときは「予定が無い」ではなく「取れなかった」と言う",
      // hints は書き込みの許可状態に関わらず常にプロンプトへ入る（既定は書き込みoff）ので、
      // aide_create_event が渡っていない回でも矛盾しない書き方にする。「渡っていません」の
      // 一般則自体は connectedServiceRules() の writeToolsWithheld 分岐が別に伝える。
      "予定の登録を頼まれたら aide_create_event を呼ぶ（道具の一覧に無ければ書き込みが許可されていないので、設定の画面で許可すれば使えると伝える）。作成できたら返る url を「入れました」の案内に添える。予定の変更・取り消しはできない（新規作成専用）ので、頼まれたら DaySpan で直接直してほしいと伝える",
    ],
    // `guchi-apps/aide` のMCP層が出している、あとから取り消せない結果が残る道具。
    // `aide_zaim_payment` は説明文に「この経路から取り消し・修正はできない」と明記されている。
    //
    // **#167で4件足した。** #78の時点では `zaim.ts` / `issue.ts` の2本しか見ておらず、
    // 通知・タスク候補・日次まとめ・支払いの取り込みが**渡ったまま**になっていた。
    // 名指しで止める形なので、**挙げ漏らした道具はそのまま渡る**——AIDE側が道具を足したら
    // ここも足すこと。
    writeTools: [
      "aide_zaim_payment",
      "aide_create_issue",
      "aide_create_notification",
      "aide_create_task_candidate",
      "aide_save_daily_brief",
      "asset_manager_import_payment",
      "aide_create_event",
    ],
  },
  {
    id: "notion",
    label: "Notion",
    url: "https://mcp.notion.com/mcp",
    description: "Notionのページとデータベースの検索・閲覧・編集",
    provides: [
      "Notionのページ・データベースの検索と閲覧",
      "自宅の情報（住まい・暮らしの決まりごと）の取り込み元（#167）",
    ],
    missing: [],
    hints: [],
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

/**
 * その接続先を繋いでいるときにプロンプトへ足す指示（#184）。
 *
 * プリセットに無い接続先では空。把握していない接続先に指示は書けない。
 */
export function hintsFor(url: string): string[] {
  return findPreset(url)?.hints ?? [];
}
