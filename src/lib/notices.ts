import { NoticePriority, type Notice } from "@prisma/client";

import { NOTICE_SKIP_TOKEN, NOTICE_URGENT_MARK, noticeSystemPrompt } from "@/lib/anthropic";
import { NOTICE_MODEL } from "@/lib/chat-model";
import { runCodexExec } from "@/lib/codex";
import { db } from "@/lib/db";
import { safeNoticeUrl } from "@/lib/notice-url";
import { sendPushToUser } from "@/lib/push/subscriptions";
import { recordApiUsage } from "@/lib/usage";

/**
 * お知らせの受け皿と、そこから1件を選んで吹き出しへ出す仕組み（#93）。**サーバー専用。**
 *
 * 各アプリが `POST /api/notices` で「利用者に知らせたいこと」を積み、「話す」画面で待って
 * いる間、秘書がここから1件を選んで自分の言葉に直す。#79の朝の見通しと違い、材料を外部
 * サービスから取りに行かない——材料はもう積まれている。
 *
 * ## 読まれなくなる吹き出しを作らないための決めごと
 *
 * 朝の見通し（#79）が「成功を毎回送ると肝心の失敗が埋もれる」を避けたのと同じ問題が、
 * ここにもそのままある。溜まったものを順に垂れ流すと、吹き出しは背景の一部になって
 * 誰も読まなくなる。
 *
 * - **一度に出すのは1件だけ。** 選ぶのはモデルで、選ばれなかったものは次の回まで残る
 * - **いま伝える価値が無ければ黙る。** `NOTICE_SKIP_TOKEN` を返した回は何も出さない
 * - **一度出したものは繰り返さない。** `shownAt` が入った行はもう候補にならない
 * - **未読が0件ならモデルを1回も叩かない。** 黙っている間の費用も、消費する枠も0
 *
 * ## 選ばせる相手（#132）
 *
 * **#132でAnthropic ClaudeからCodex CLI（ChatGPTサブスク経由）へ移した**（チャットの#128に続く
 * 2本目）。サブスクの定額制で動くため、1回あたりの単価という意味での費用は掛からない。
 * 代わりに**Codexが自前の指示文を毎回前置きするので、入力は1回あたり約12,600トークン**
 * （うち約8,960はキャッシュ読み。実測）になった。40字の一言を書くための量としては大きいので、
 * 「未読が0件なら叩かない」「10分に1回まで」という上の歯止めは、これまでより効いている。
 */

/** 選び直す間隔。画面を開いている間、これより短い間隔ではモデルを呼ばない。 */
export const NOTICE_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 急ぎが届いたときに、選び直しまで最低限あける間隔。
 *
 * 「急ぎならすぐに」を素直に書くと、急ぎが立て続けに積まれた回に何度も生成が走る。
 * まだ一度も候補に入れていない急ぎがあることを条件にしたうえで、さらにこの間隔で床を張る。
 */
export const NOTICE_URGENT_INTERVAL_MS = 60 * 1000;

/**
 * 出した吹き出しを画面に残しておく時間。
 *
 * これを過ぎたものは「どうぞ、話しかけてください」へ戻す。**残し続けると、朝に選ばれた
 * お知らせが夜まで頭上に居座る**ことになり、いま知らせている内容だと誤解される。
 */
export const NOTICE_DISPLAY_TTL_MS = 60 * 60 * 1000;

/** 1回の生成でモデルへ渡す候補の数。多すぎると選ぶ精度も入力の短さも失う。 */
const MAX_CANDIDATES = 12;

/** 急ぎのお知らせをPushで届けたときの `NotificationLog.kind`。 */
const URGENT_NOTICE_KIND = "urgent-notice";

/**
 * 通知を押して開いた相談の1通目（USER）に置く固定の文言。
 *
 * `POST /api/chat` の `toPromptMessages()`（#79）は履歴の先頭がUSERであることを前提にしており、
 * ASSISTANTから始まる履歴は先頭を落として渡す。ここはモデルを呼ばずに積む側の文面をそのまま
 * 出す設計（#93「黙っている間の費用は0円」）なので、朝の見通し（`MORNING_BRIEFING_REQUEST`）
 * のような「実際にモデルへ渡した依頼」ではなく、続けて話しかけたときにモデルが読む文脈として
 * 置くだけの短い定型文にしてある。
 */
const URGENT_NOTICE_REQUEST = "（自動）急ぎのお知らせを教えて。";

/**
 * 直近の生成の記録。**プロセス内にだけ持つ。**
 *
 * DBへ持たないのは、これが「次にいつ叩いてよいか」を決めるためだけの値で、失っても
 * 1回余分に生成されるだけだから（PM2で1プロセスという既存の前提。#48の
 * `pendingGenerations` と同じ置き方）。
 *
 * `NOTICE_SKIP_TOKEN` で黙った回もここに残す。残さないと、黙った直後の問い合わせが
 * また生成を始めてしまい、**いちばん起こりやすい「知らせることが無い」場面で費用が
 * 10倍になる。**
 */
type LastRun = {
  at: number;
  /** その回に候補として渡したお知らせのID。急ぎの取りこぼしを見分けるために持つ。 */
  consideredIds: Set<string>;
};

const lastRuns = new Map<string, LastRun>();

/** 積む側から受け取る1件ぶん。 */
export type NoticeInput = {
  source: string;
  kind: string;
  dedupeKey: string;
  title?: string;
  body: string;
  url?: string | null;
  priority?: NoticePriority;
  showAt?: Date | null;
  expiresAt?: Date | null;
};

/** 画面へ渡す、いま吹き出しに出ているもの。 */
export type CurrentNotice = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選んだ時刻（ISO）。吹き出しの末尾に「いつ時点か」を出すために使う。 */
  shownAt: string;
  /**
   * 押したときに開く先（#137）。積む側が付けた元データへのリンクで、無ければnull。
   * **必ず `safeNoticeUrl()` を通してから渡す**——`href` へそのまま入る値のため。
   */
  url: string | null;
};

/**
 * お知らせを積む。同じ `(source, kind, dedupeKey)` は上書きする。
 *
 * 上書きにしてあるのは、積む側が同じ用件を状況の変化に合わせて投げ直せるようにするため
 * （「あと30分」→「あと8分」）。**すでに出したものは書き戻さない**——出し終えた行を
 * 未読へ戻すと、同じ話が何度でも吹き出しに出る。
 */
export async function ingestNotice(userId: string, input: NoticeInput): Promise<Notice> {
  const data = {
    title: input.title ?? input.body.split("\n", 1)[0].slice(0, 120),
    body: input.body,
    // 保存の時点でも形を確かめる（#137）。積む口（`parseNoticeInput()`）は先に弾くが、
    // アプリの中から呼ぶ経路（朝の見通し。`briefing.ts`）はそこを通らない。
    url: safeNoticeUrl(input.url),
    priority: input.priority ?? NoticePriority.NORMAL,
    showAt: input.showAt ?? null,
    expiresAt: input.expiresAt ?? null,
  };

  const notice = await db.notice.upsert({
    where: {
      userId_source_kind_dedupeKey: {
        userId,
        source: input.source,
        kind: input.kind,
        dedupeKey: input.dedupeKey,
      },
    },
    create: { userId, source: input.source, kind: input.kind, dedupeKey: input.dedupeKey, ...data },
    update: data,
  });

  // 急ぎ（#115）。「話す」画面を開いている端末にしか届かない吹き出しとは別に、その場でPushを
  // 送る。失敗しても積んだこと自体は成立させたいので、独立したtry/catchに包む
  // （#51・#79と同じ「記録・通知の失敗で本筋を止めない」方針）。
  if (notice.priority === NoticePriority.URGENT) {
    try {
      await notifyUrgentNotice(userId, notice);
    } catch (error) {
      console.error("[aide-bot] 急ぎのお知らせのPush送信に失敗した", error);
    }
  }

  return notice;
}

/**
 * 急ぎ（`URGENT`）のお知らせをその場でPushする（#115）。
 *
 * `URGENT` が効くのはこれまで「選び直しの間隔を10分から1分へ詰める」ところまでで、
 * `/api/notices/current` を叩くのは「話す」画面を開いている端末だけだった。画面を閉じていれば
 * 届かないまま `expiresAt` を過ぎるため、ここでは経路を分けてWeb Pushを直接送る。
 *
 * - **文面はモデルに書かせない。** 積む側の `body` をそのまま出す。生成を挟むと#93の
 *   「黙っている間の費用は0円」が崩れる
 * - **抑制は `NotificationLog` の一意制約に任せる。** `dedupeKey` に `Notice.id` を使うと、
 *   `ingestNotice()` が同じ用件を上書き（例: 「あと30分」→「あと8分」）した回も同じidのまま
 *   なので、2回目以降は一意制約に触れて弾かれる——**Push・Conversationの多重生成を避けるため、
 *   先に一意制約の有無を確かめてから重い処理へ進む**（TOCTOUは残るが、同じ用件が短時間に
 *   何度も届く運用ではないため許容している）
 * - **押した先は、リンクがあればそのページ（#137）。** 積む側が `url` を付けた用件では、その
 *   ページを開く方が用が足りる（「支払期限が近い」を押して支払いの画面が出る）。**リンクが
 *   無い用件だけ、これまでどおり相談を開く**
 * - **リンクの有無によらず相談は作る。** 押した先が外のアプリでも、届いた文面と時刻は左の
 *   メニューから辿れるようにしておく（`NotificationLog.conversationId` もそこを指す）
 * - **相談の中身は変えない。** 1通目はUSER（`toPromptMessages()` の制約を満たす固定文言）、
 *   2通目はASSISTANTとして `body` をそのまま置く。モデルを呼ばずに「秘書からのお知らせ」として
 *   自然に見せるための構成で、朝の見通し（#79）の「USER=依頼・ASSISTANT=生成物」とは違い、
 *   ASSISTANT側も積んだ側の文面そのもの
 * - **1日あたりの上限は設けない。** 同じ用件の二重送信だけを防ぐ
 * - **`showAt` / `expiresAt` は吹き出し側（`pendingNotices()`）と同じ条件で絞る。** ここを
 *   見ないと、まだ早い用件が積まれた瞬間に飛んだり、届く前に意味を失った用件までPushして
 *   しまう。**まだ早い分は、その時刻が来ても改めては送らない**——`showAt` の到来だけを
 *   拾う仕組みは無く、次に同じ用件が積み直された（`ingestNotice()` が呼ばれ直した）ときに
 *   初めて判定し直す
 */
async function notifyUrgentNotice(userId: string, notice: Notice): Promise<void> {
  const now = new Date();

  if (notice.showAt && notice.showAt > now) return;
  if (notice.expiresAt && notice.expiresAt <= now) return;

  const existing = await db.notificationLog.findUnique({
    where: {
      userId_kind_dedupeKey: { userId, kind: URGENT_NOTICE_KIND, dedupeKey: notice.id },
    },
  });
  if (existing) return;

  const conversation = await db.conversation.create({
    data: {
      userId,
      title: notice.title,
      messages: {
        create: [
          { role: "USER", content: URGENT_NOTICE_REQUEST },
          // 同じ時刻だと並び順が不定になる。1秒ずらして返答を後ろに固定する（#79と同じ手当て）。
          { role: "ASSISTANT", content: notice.body, createdAt: new Date(now.getTime() + 1000) },
        ],
      },
    },
    select: { id: true },
  });

  const delivered = await sendPushToUser(userId, {
    title: notice.title,
    body: notice.body,
    // 積む側が付けたリンクがあればそこへ、無ければいま作った相談へ（#137）。
    url: safeNoticeUrl(notice.url) ?? `/c/${conversation.id}`,
    tag: URGENT_NOTICE_KIND,
  });

  await db.notificationLog.create({
    data: {
      userId,
      kind: URGENT_NOTICE_KIND,
      dedupeKey: notice.id,
      title: notice.title,
      body: notice.body,
      conversationId: conversation.id,
      deliveredCount: delivered,
    },
  });
}

/** まだ出していない、いま出せるお知らせ。急ぎ→新しい順。 */
async function pendingNotices(userId: string, now: Date): Promise<Notice[]> {
  return db.notice.findMany({
    where: {
      userId,
      shownAt: null,
      OR: [{ showAt: null }, { showAt: { lte: now } }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    take: MAX_CANDIDATES,
  });
}

/** いま吹き出しに出しておくもの。出してから時間が経ちすぎたものは返さない。 */
async function currentNotice(userId: string, now: Date): Promise<CurrentNotice | null> {
  const shown = await db.notice.findFirst({
    where: {
      userId,
      shownAt: { gt: new Date(now.getTime() - NOTICE_DISPLAY_TTL_MS) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: { shownAt: "desc" },
  });

  if (!shown?.shownAt || !shown.spokenText) return null;

  return {
    id: shown.id,
    text: shown.spokenText,
    urgent: shown.spokenUrgent,
    shownAt: shown.shownAt.toISOString(),
    url: safeNoticeUrl(shown.url),
  };
}

/**
 * 生成を走らせてよいか。
 *
 * 通常は `NOTICE_INTERVAL_MS` に1回まで。ただし**まだ一度も候補に入れていない急ぎ**が
 * 積まれているときは、`NOTICE_URGENT_INTERVAL_MS` まで詰めて先に出す（「急ぎならすぐに」）。
 */
function shouldGenerate(userId: string, pending: Notice[], now: Date): boolean {
  if (pending.length === 0) return false;

  const last = lastRuns.get(userId);
  if (!last) return true;

  const elapsed = now.getTime() - last.at;
  if (elapsed >= NOTICE_INTERVAL_MS) return true;

  const freshUrgent = pending.some(
    (notice) => notice.priority === NoticePriority.URGENT && !last.consideredIds.has(notice.id),
  );

  return freshUrgent && elapsed >= NOTICE_URGENT_INTERVAL_MS;
}

/** モデルへ渡す候補の一覧。番号で選ばせるので、番号と本文の対応をそのまま書く。 */
function candidateList(pending: Notice[], now: Date): string {
  const lines = pending.map((notice, index) => {
    const parts = [`${index + 1}. ${notice.body}`];
    if (notice.priority === NoticePriority.URGENT) parts.push("（積んだ側の申告: 急ぎ）");
    if (notice.expiresAt) {
      const minutes = Math.round((notice.expiresAt.getTime() - now.getTime()) / 60000);
      parts.push(`（あと約${minutes}分で意味が無くなります）`);
    }
    return parts.join(" ");
  });

  const stamp = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);

  return `いまは${stamp}です。候補は次の${pending.length}件です。\n\n${lines.join("\n")}`;
}

/** モデルの返答。1行目が「番号（と急ぎの印）」、2行目が吹き出しに出す文。 */
type Choice = { index: number; urgent: boolean; text: string };

/**
 * モデルの返答を読む。**知らない形で返ってきたら黙る**（nullを返す）。
 *
 * 無理に読み取ろうとすると、前置きの一文がそのまま吹き出しに出たり、番号として読めない
 * ものを0番と見なして関係の無いお知らせを消費したりする。
 */
function parseChoice(answer: string, candidates: number): Choice | null {
  const lines = answer
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  if (lines.length === 0) return null;
  if (lines[0] === NOTICE_SKIP_TOKEN) return null;

  const head = /^(\d+)(?:\s+(\S+))?$/.exec(lines[0]);
  if (!head) return null;

  const index = Number(head[1]) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= candidates) return null;

  const text = lines.slice(1).join(" ");
  if (text === "") return null;

  return { index, urgent: head[2] === NOTICE_URGENT_MARK, text };
}

/**
 * `codex exec` を待つ上限（#132）。
 *
 * 実測（サブPC・`gpt-5.6-luna`）では3.5〜5.3秒で返る。上限を置くのは、返らなくなったときに
 * `/api/notices/current` の応答がそのまま止まるため——この経路は「話す」画面から1分ごとに
 * 叩かれるので、詰まったリクエストが積み上がる。実測の10倍以上を取って、遅いだけの回を
 * 切らない値にしてある。
 */
const CODEX_TIMEOUT_MS = 60 * 1000;

/**
 * `codex exec` へ渡す1本のプロンプト（#132）。
 *
 * Codexにはシステムプロンプトを別に渡す口が無いので、相談（`buildCodexPrompt()`。
 * `src/app/api/chat/route.ts`）と同じく、体裁の指示と候補一覧を区切り線で繋いだ1本にする。
 *
 * **末尾に「本文だけを返せ」の一文を足していない。** 相談と違い、`noticeSystemPrompt()` が
 * 返させる形（1行目に番号、2行目に本文、3行目以降は書かない）を最後まで指定しているため。
 */
function buildNoticePrompt(pending: Notice[], now: Date): string {
  return [noticeSystemPrompt(), "---", candidateList(pending, now)].join("\n\n");
}

/**
 * 候補を渡して1件選ばせる。道具は渡さない（材料はもう候補の中にある）。
 *
 * **#132でAnthropic ClaudeからCodex CLIへ移した。** サブスクの定額制で動くためトークン単価の
 * 概念に合わないが、**#133で使ったトークン量そのものは `ApiUsage` へ残すようにした**——
 * `/usage` の「相談・お知らせ」の節に量として出る。`conversationId` は付かない（選定は
 * 相談の外で走る）。金額には積まれない（`billingKind()` が単価表を引かせない）。
 *
 * **失敗した回は投げる。** 呼び出し元は例外を捕まえて `lastRuns` を更新せずに戻るため、
 * 次の問い合わせでやり直せる（#93「生成に失敗した回は何も消費しない」）。**逆に、読めない形で
 * 返ってきた回は「黙った」ものとして `null` を返す**——モデルは実際に答えており、同じ候補で
 * すぐ叩き直しても結果は変わらないため。
 */
async function chooseNotice(userId: string, pending: Notice[], now: Date): Promise<Choice | null> {
  const result = await runCodexExec({
    model: NOTICE_MODEL,
    prompt: buildNoticePrompt(pending, now),
    signal: AbortSignal.timeout(CODEX_TIMEOUT_MS),
  });

  // 使った量は、読める形で返ってきたかに関わらず残す。**上限に掛かった回は`usage`がnullで
  // 行が作られない**——`turn.completed` が届いていないので、そこまでの消費量が分からない。
  if (result.usage) {
    await recordApiUsage({ userId, conversationId: null, model: NOTICE_MODEL, usage: result.usage });
  }

  // 打ち切りは上限に掛かったときにしか起きない（この経路に利用者からの割り込みは無い）。
  if (result.interrupted) {
    throw new Error(`お知らせの選定が${CODEX_TIMEOUT_MS / 1000}秒で返らなかった`);
  }
  if (result.errorMessage) {
    throw new Error(result.errorMessage);
  }

  return parseChoice(result.text.trim(), pending.length);
}

/**
 * いま吹き出しに出すものを返す。「話す」画面から定期的に呼ばれる。
 *
 * 生成が要らない回（間隔の中・未読が0件）はDBを引くだけで戻る。**生成に失敗した回は
 * 何も消費しない**——`lastRuns` にも残さないので、次の問い合わせでやり直せる
 * （#79「生成に失敗した日は記録を残さない」と同じ理由）。
 */
export async function resolveNotice(userId: string, now = new Date()): Promise<CurrentNotice | null> {
  const pending = await pendingNotices(userId, now);

  if (!shouldGenerate(userId, pending, now)) {
    return currentNotice(userId, now);
  }

  let choice: Choice | null;
  try {
    choice = await chooseNotice(userId, pending, now);
  } catch (error) {
    // 吹き出しにエラーを出さない。出しても利用者にできることが無く、状況を知らせる場所が
    // 小言で埋まるだけになる。ログにだけ残し、いま出しているものをそのまま続ける。
    console.error("[aide-bot] お知らせの選定に失敗した", error);
    return currentNotice(userId, now);
  }

  // 黙った回も「叩いた」ものとして残す。残さないと次の問い合わせでまた叩く。
  lastRuns.set(userId, { at: now.getTime(), consideredIds: new Set(pending.map((n) => n.id)) });

  if (!choice) return currentNotice(userId, now);

  const chosen = pending[choice.index];
  const updated = await db.notice.update({
    where: { id: chosen.id },
    data: { spokenText: choice.text, spokenUrgent: choice.urgent, shownAt: now },
  });

  return {
    id: updated.id,
    text: choice.text,
    urgent: choice.urgent,
    shownAt: now.toISOString(),
    url: safeNoticeUrl(updated.url),
  };
}
