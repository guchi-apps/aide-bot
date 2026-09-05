import { HOME_PROFILE_MODEL } from "@/lib/chat-model";
import { runCodexExec } from "@/lib/codex";
import { db } from "@/lib/db";
import { listConnectedServers, toCodexMcpServers } from "@/lib/mcp/connections";
import { MCP_PRESETS } from "@/lib/mcp/presets";
import { recordApiUsage } from "@/lib/usage";

/**
 * 自宅と暮らしの前提（#167）。**サーバー専用。**
 *
 * 秘書は「いまの部屋の温度」（AIDEの `aide_room_status`）は道具で引けるのに、**利用者が
 * どこに住んでいるかを知らない。** そのため天気や地域の話になると場所を聞き返す。
 * Notionの「しおり」には住所・最寄り駅・座標・ゴミの収集曜日・契約しているインフラが
 * 揃っているので、それを覚え書きとして取り込み、相談のプロンプトへ毎回載せる。
 *
 * ## 道具として引かせない
 *
 * 相談のたびにNotionを検索させると、**呼ぶたびに返事が約9秒遅れる**（#131で実測）。
 * 自宅の情報は年単位で変わらないので、話題（#144）と同じく**先に取り込んでDBへ置き、
 * 相談側はDBを1回引くだけ**にしてある。相談1往復の待ち時間は増えない。
 *
 * ## 取り込みの起点
 *
 * 1. 設定の画面のボタン（`POST /api/settings/home-profile`）
 * 2. cronが叩く `/api/briefing`（#79）の起動時に、前回から1日あいていれば1回だけ
 *
 * 話題（#144）のように「話す」画面の問い合わせへは相乗りさせない。あちらは1時間ごとに
 * 走らせたいもので、こちらは1日1回で足りる——1分ごとに叩かれる経路へ判定を足すと、
 * 何も取り込まない回のDBアクセスだけが積み上がる。
 */

/** 取り込み直す間隔。住所や契約先はそう変わらないので1日1回で足りる。 */
export const HOME_PROFILE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * 保存する覚え書きの上限。
 *
 * 相談のプロンプトへ毎回載る（＝毎往復の入力トークンになる）ので、モデルへの指示
 * （800文字）より少しだけ広く取って切る。溢れたぶんを捨てるだけで失敗にはしない。
 */
export const HOME_PROFILE_MAX_LENGTH = 1000;

/**
 * 「Notionに自宅の情報が見つからなかった」ときに返させる合図。
 *
 * 見つからなかったことと取り込みの失敗を分けるために要る。**見つからなかった回も
 * `homeProfileFetchedAt` は進める**——次の起動でまた同じ検索を走らせないため。
 */
const SKIP_TOKEN = "NO_HOME_PROFILE";

/**
 * `codex exec` を待つ上限。
 *
 * Notionの検索と本文の読み込みで道具を数回呼ぶ。話題の仕入れ（150秒。`topics.ts`）より
 * 短くしてあるのは、こちらは設定の画面のボタンからも走り、利用者が画面の前で待つため。
 */
const CODEX_TIMEOUT_MS = 120 * 1000;

/** 取り込みの結果。画面とcronのログに出す。 */
export type HomeProfileResult =
  | { status: "saved"; profile: string }
  /** Notionに見当たらなかった回。失敗ではない。 */
  | { status: "empty" };

/** Notionのプリセット接続。繋いでいるかどうかを画面へ出すのに使う。 */
const NOTION_PRESET = MCP_PRESETS.find((preset) => preset.id === "notion");

/**
 * Notion（プリセットのURL）へ繋いでいるか。
 *
 * 設定の画面が「繋いでいないので取り込めない」を先に案内するためだけに使う。
 * 取り込みそのものはこの判定で止めない——利用者が自分でURLを入れて繋いだNotionも
 * ありうるので、繋いでいる接続を全部渡し、見つからなければ `empty` で戻る。
 */
export function hasNotionConnection(urls: string[]): boolean {
  return NOTION_PRESET !== undefined && urls.includes(NOTION_PRESET.url);
}

/**
 * Codexへ渡す1本のプロンプト。
 *
 * Codexにはシステムプロンプトを別に渡す口が無い（`buildNoticePrompt()`・
 * `buildTopicPrompt()` と同じ）。**探す場所を名指ししすぎない**——Notionの構成は
 * 利用者が変えるもので、ページ名を決め打ちにすると移動しただけで取れなくなる。
 */
function buildHomeProfilePrompt(): string {
  const rules = [
    "Notionの道具で「自宅」「住所」「よく行く場所」「プロフィール」「ゴミ」などを検索し、" +
      "見つかったページの中身を読んでから書く",
    "書いてよいのはNotionに実際に書かれていることだけ。推測で補わない・それらしい値を作らない",
    "全体で800文字以内。1行1項目の箇条書きにする。見出し・URL・前置き・まとめの一文は書かない",
    "日付・曜日・数量・会社名は、Notionにある値をそのまま書く",
    `自宅に関わる記述がNotionに1つも見つからなければ、${SKIP_TOKEN} とだけ返す`,
  ];

  const wanted = [
    "住まい: 住所・最寄り駅・市区町村（天気や地域の話で場所を聞き返さずに済む粒度で）",
    "暮らしの決まりごと: ゴミの収集曜日など、日付や曜日で効くもの",
    "契約しているインフラ: 電気・ガス・水道・通信などの会社名",
    "そのほか相談の前提になる基本情報: 家族構成・勤務先や通勤の事情・車など",
  ];

  return [
    "あなたは利用者ひとりに付く秘書です。利用者のNotionを調べて、これから相談に答えるときに" +
      "手元へ置いておく「自宅と暮らしの前提」の覚え書きを作ってください。",
    `覚え書きに入れるもの（Notionで見つかったものだけ。見つからない項目はその行ごと書かない）:\n${wanted
      .map((item) => `- ${item}`)
      .join("\n")}`,
    `決まりごと:\n${rules.map((rule) => `- ${rule}`).join("\n")}`,
  ].join("\n\n");
}

/**
 * Notionから取り込んで保存する。**失敗は投げる**（呼び出し元が画面かログへ出す）。
 *
 * - **書き込みの道具は設定によらず常に止める**（`toCodexMcpServers(servers, false)`）。
 *   朝の見通し（#79）と同じで、ここには復唱して確かめる相手がいない。読むだけの用事しかない
 * - 使った量は `ApiUsage` へ残す（#133。`conversationId` は付かない）
 * - 見つからなかった回も `homeProfileFetchedAt` を進める。**本文は消さない**——前に取り込めた
 *   覚え書きは、次に取り込めるまで持っている方がよい
 */
export async function refreshHomeProfile(userId: string, now = new Date()): Promise<HomeProfileResult> {
  const servers = await listConnectedServers(userId);
  if (servers.length === 0) {
    throw new Error("外部サービスへ繋いでいないため、自宅の情報を取り込めませんでした。");
  }

  const { mcpServers } = toCodexMcpServers(servers, false);

  const result = await runCodexExec({
    model: HOME_PROFILE_MODEL,
    prompt: buildHomeProfilePrompt(),
    signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
    mcpServers,
  });

  if (result.usage) {
    await recordApiUsage({
      userId,
      conversationId: null,
      model: HOME_PROFILE_MODEL,
      usage: result.usage,
    });
  }

  // 打ち切りは上限に掛かったときにしか起きない（この経路に利用者からの割り込みは無い）。
  if (result.interrupted) {
    throw new Error(`自宅の情報の取り込みが${CODEX_TIMEOUT_MS / 1000}秒で返らなかった`);
  }
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }

  // 道具を呼んだ回は「調べます」の一言が別の `agent_message` として先に届く（#131）。
  // 覚え書きは最後の道具より後ろの本文だけを繋いだ `reply` にある。
  const answer = result.reply.trim();

  if (answer === "" || answer.includes(SKIP_TOKEN)) {
    await db.user.update({ where: { id: userId }, data: { homeProfileFetchedAt: now } });
    return { status: "empty" };
  }

  const profile = answer.slice(0, HOME_PROFILE_MAX_LENGTH);
  await db.user.update({
    where: { id: userId },
    data: { homeProfile: profile, homeProfileFetchedAt: now },
  });

  return { status: "saved", profile };
}

/**
 * 前回から間隔があいていれば取り込む。**cronの経路（`/api/briefing`）から呼ぶ。**
 *
 * 走らせなかった回・失敗した回はログにだけ残して黙る（朝の見通しそのものを止めない）。
 * 戻り値はcronのログに出す一言。
 */
export async function refreshHomeProfileIfStale(userId: string, now = new Date()): Promise<string> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { homeProfileFetchedAt: true },
  });

  const fetchedAt = user?.homeProfileFetchedAt ?? null;
  if (fetchedAt && now.getTime() - fetchedAt.getTime() < HOME_PROFILE_REFRESH_INTERVAL_MS) {
    return "取り込み済み";
  }

  try {
    const result = await refreshHomeProfile(userId, now);
    return result.status === "saved" ? "取り込んだ" : "Notionに見当たらない";
  } catch (error) {
    // ここで失敗しても、前に取り込んだ覚え書きはそのまま使える。
    console.error("[aide-bot] 自宅の情報の取り込みに失敗した", error);
    return error instanceof Error ? `失敗: ${error.message}` : "失敗";
  }
}

/**
 * 利用者全員ぶんの取り込みを1回まわす。**cronが叩く `/api/briefing` から呼ぶ。**
 *
 * 1人が失敗しても他は続ける（`runMorningBriefing()` と同じ方針）。戻り値はcronのログに
 * 出す一言で、実際に取り込んだのか間隔で見送ったのかを後から追えるようにしてある。
 */
export async function refreshHomeProfiles(now = new Date()): Promise<Record<string, string>> {
  const users = await db.user.findMany({ select: { id: true } });
  const outcomes: Record<string, string> = {};

  for (const user of users) {
    outcomes[user.id] = await refreshHomeProfileIfStale(user.id, now);
  }

  return outcomes;
}
