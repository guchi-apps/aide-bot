import { NoticePriority } from "@prisma/client";

import { AppIcon } from "@/components/brand/app-icon";
import type { NoticeBoard, NoticeRow } from "@/lib/notice-list";
import { cn } from "@/lib/utils";

type Props = {
  board: NoticeBoard;
  /** 描画の基準になる時刻。「あと◯分」の計算に使う（サーバー側で決めて渡す）。 */
  now: Date;
  /** 吹き出しに残しておく時間（ミリ秒）。「あと◯分で引っ込みます」に使う。 */
  displayTtlMs: number;
};

/**
 * 積まれたお知らせの一覧（#114）。
 *
 * `/usage` と同じくサーバーコンポーネントのまま置いている。見るだけで操作が無く、
 * クライアントにすると `@/lib/notice-list`（Prismaを引き込む）がバンドルへ入る。
 *
 * 並べる順は「これから」が先。読む理由があるのはまだ出ていない候補で、履歴はその下に置く。
 */
export function NoticesView({ board, now, displayTtlMs }: Props) {
  const { current, pending, waiting, shown, expired, historyDays } = board;

  const urgentCount = pending.filter((n) => n.priority === NoticePriority.URGENT).length;

  // 上段の「待っている」は、**いま出せるものだけ**を数える（左メニューの未読の件数と同じ）。
  // まだ出せないもの（`showAt` が先）をここに足すと、左メニューの数字と食い違う。
  const pendingNote =
    [
      urgentCount > 0 ? `うち急ぎ ${urgentCount}件` : null,
      waiting.length > 0 ? `時間待ち ${waiting.length}件` : null,
    ]
      .filter(Boolean)
      .join(" ・ ") || "急ぎはありません";
  const shownToday = shown.filter((n) => n.shownAt && isSameJstDate(n.shownAt, now)).length;
  const currentToday = current?.shownAt && isSameJstDate(current.shownAt, now) ? 1 : 0;
  const empty =
    !current && pending.length === 0 && waiting.length === 0 && shown.length === 0 && expired.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3.5 py-4 md:gap-5 md:px-7 md:py-6">
        <div className="grid grid-cols-3 gap-2.5 md:gap-3">
          <Stat label="待っている" value={pending.length} note={pendingNote} highlighted />
          <Stat
            label="いま出している"
            value={current ? 1 : 0}
            note={current ? remainingLabel(current, now, displayTtlMs) : "吹き出しは待機中です"}
          />
          <Stat label="今日出した" value={shownToday + currentToday} note="選び直しは10分に1回" />
        </div>

        {empty && (
          <p className="rounded-xl border border-border bg-surface px-4 py-3 text-xs leading-relaxed text-muted">
            まだお知らせがありません。ほかのアプリがこのアプリへ積むと、ここに並びます。
          </p>
        )}

        {current && (
          <section className="flex flex-col gap-3 rounded-xl border border-accent/45 bg-surface p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[0.8125rem] font-bold">いま出しています</h2>
              <span className="text-[0.6875rem] text-muted">
                {current.shownAt && `${elapsedLabel(current.shownAt, now)}に選びました`}
              </span>
            </div>

            {/* 秘書が実際に話した言葉。積んだ側の文面より、こちらを大きく出す。 */}
            <div className="flex items-start gap-2.5 rounded-xl bg-accent-surface px-3.5 py-3">
              <AppIcon className="mt-0.5 size-6 shrink-0" />
              <p className="text-[0.9375rem] font-medium leading-relaxed">
                {current.spokenText}
                <span className="mt-1 block text-[0.6875rem] font-normal leading-relaxed text-muted">
                  元のお知らせ:「{current.body}」（{current.source} ・ {current.kind}）
                </span>
              </p>
            </div>
          </section>
        )}

        {pending.length > 0 && (
          <Section title={`待っている候補（${pending.length}件）`} hint="急ぎ → 新しい順">
            {pending.map((notice) => (
              <PendingRow key={notice.id} notice={notice} now={now} />
            ))}
          </Section>
        )}

        {/* まだ出せないもの。候補からは外れているので、件数も欄も分ける（混ぜると左メニューの
            未読の件数と食い違う）。 */}
        {waiting.length > 0 && (
          <Section title={`まだ出せないもの（${waiting.length}件）`} hint="出せる時刻が早い順">
            {waiting.map((notice) => (
              <PendingRow key={notice.id} notice={notice} now={now} waiting />
            ))}
          </Section>
        )}

        {shown.length > 0 && (
          <Section title={`出したもの（直近${historyDays}日）`} hint="秘書が実際に話した言葉">
            {shown.map((notice) => (
              <ShownRow key={notice.id} notice={notice} now={now} />
            ))}
          </Section>
        )}

        {expired.length > 0 && (
          <Section title="出さないまま終わったもの" hint={`直近${historyDays}日`}>
            {expired.map((notice) => (
              <ExpiredRow key={notice.id} notice={notice} now={now} />
            ))}
          </Section>
        )}

        <p className="text-[0.6875rem] leading-relaxed text-muted">
          <b className="font-medium text-foreground">
            一度出したお知らせは、二度と候補に戻りません。
          </b>
          候補が残っていても、いま伝える価値が無いと判断した回は秘書が黙ります。選び直すのは
          10分に1回までで、急ぎが積まれたときだけ1分まで詰めます。ここに出るのはほかのアプリから
          このアプリへ積まれたぶんだけで、朝の見通しの通知そのものの履歴ではありません。
        </p>
      </div>
    </div>
  );
}

/**
 * 上段の数え札。`/usage` の `SummaryCard` と同じ形で、数字と一行の注記を持つ。
 *
 * スマホ（393px）でも3枚を横に並べる。縦に積むと、いちばん見たい「待っている件数」を
 * 見るのに一覧が画面の外へ押し出される。
 */
function Stat({
  label,
  value,
  note,
  highlighted = false,
}: {
  label: string;
  value: number;
  note: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-0.5 rounded-xl border border-border bg-surface px-2.5 py-3 md:px-4 md:py-3.5",
        highlighted && "border-accent/45 bg-accent-surface",
      )}
    >
      <div className="text-[0.6875rem] font-bold tracking-[0.1em] text-muted">{label}</div>
      <div className="flex items-baseline gap-1 tabular-nums">
        <b className="text-[1.375rem] font-bold leading-tight tracking-tight md:text-[1.625rem]">
          {value}
        </b>
        <span className="text-[0.8125rem] text-muted">件</span>
      </div>
      <div className="text-[0.6875rem] leading-relaxed text-muted">{note}</div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[0.8125rem] font-bold">{title}</h2>
        <span className="text-[0.6875rem] text-muted">{hint}</span>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

/**
 * 1件ぶんの枠。見出し・本文・積んだ元の3段で、どの欄でも同じ形にする。
 *
 * 幅で列を組まないのは、本文の長さがまちまちで、スマホ（393px）だと2列目が
 * 2文字ずつ折り返すため。
 */
function Row({
  head,
  when,
  children,
  meta,
  dim = false,
}: {
  head: React.ReactNode;
  when: string;
  children: React.ReactNode;
  meta: string[];
  dim?: boolean;
}) {
  return (
    <article className="flex flex-col gap-1 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        {head}
        {/* PCでは右端へ寄せ、スマホでは折り返して次の行の先頭へ落とす。 */}
        <span className="w-full shrink-0 text-[0.6875rem] tabular-nums text-muted md:ml-auto md:w-auto">
          {when}
        </span>
      </div>
      <div className={cn("text-[0.8125rem] leading-relaxed", dim && "text-muted")}>{children}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted">
        {meta.map((part, index) => (
          <span key={part + index}>
            {index > 0 && <span className="mr-1.5 opacity-50">・</span>}
            {part}
          </span>
        ))}
      </div>
    </article>
  );
}

function PendingRow({
  notice,
  now,
  waiting = false,
}: {
  notice: NoticeRow;
  now: Date;
  waiting?: boolean;
}) {
  return (
    <Row
      dim={waiting}
      head={
        <>
          {waiting ? (
            <Chip tone="wait">{timeLabel(notice.showAt)}から</Chip>
          ) : (
            <PriorityChip priority={notice.priority} />
          )}
          <span className={cn("text-sm font-semibold", waiting && "text-muted")}>
            {notice.title}
          </span>
        </>
      }
      when={
        waiting
          ? `${timeLabel(notice.showAt)}から出せます`
          : notice.expiresAt
            ? `あと${durationLabel(notice.expiresAt.getTime() - now.getTime())}`
            : "期限なし"
      }
      meta={[notice.source, notice.kind, `${stampLabel(notice.createdAt, now)}に届きました`]}
    >
      {notice.body}
    </Row>
  );
}

function ShownRow({ notice, now }: { notice: NoticeRow; now: Date }) {
  return (
    <Row
      head={
        <>
          {notice.spokenUrgent && <Chip tone="urgent">急ぎとして</Chip>}
          <span className="text-sm font-semibold">{notice.title}</span>
        </>
      }
      when={notice.shownAt ? stampLabel(notice.shownAt, now) : ""}
      meta={[notice.source, notice.kind]}
    >
      {/* 出したときの言葉は秘書が書き直したもの。引用として、積んだ側の文面と見分ける。 */}
      <p className="m-0 border-l-2 border-accent/55 pl-2.5">{notice.spokenText}</p>
    </Row>
  );
}

function ExpiredRow({ notice, now }: { notice: NoticeRow; now: Date }) {
  return (
    <Row
      dim
      head={<span className="text-sm font-semibold text-muted">{notice.title}</span>}
      when={notice.expiresAt ? `${stampLabel(notice.expiresAt, now)}に期限切れ` : ""}
      meta={[notice.source, notice.kind]}
    >
      {notice.body}
    </Row>
  );
}

function PriorityChip({ priority }: { priority: NoticePriority }) {
  if (priority === NoticePriority.URGENT) return <Chip tone="urgent">急ぎ</Chip>;
  if (priority === NoticePriority.LOW) return <Chip tone="low">あとで</Chip>;
  return <Chip tone="normal">ふつう</Chip>;
}

/**
 * 優先度の印。**色で急ぎを示すのは1種類だけ**にして、残りは地の色で並べる。
 * 全部に色を付けると、いちばん伝えたいものが埋もれる（#79・#93と同じ理由）。
 */
function Chip({
  tone,
  children,
}: {
  tone: "urgent" | "normal" | "low" | "wait";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded-full border border-transparent px-2 py-0.5 text-[0.625rem] font-bold",
        tone === "urgent" && "border-danger/35 bg-danger-surface text-danger",
        tone === "normal" && "bg-rail-active text-muted",
        (tone === "low" || tone === "wait") && "border-border text-muted",
      )}
    >
      {children}
    </span>
  );
}

/** 「あと48分で引っ込みます」。吹き出しから消えるまでの残り時間（#93の `NOTICE_DISPLAY_TTL_MS`）。 */
function remainingLabel(current: NoticeRow, now: Date, displayTtlMs: number): string {
  if (!current.shownAt) return "";
  const rest = current.shownAt.getTime() + displayTtlMs - now.getTime();
  return rest > 0 ? `あと${durationLabel(rest)}で引っ込みます` : "まもなく引っ込みます";
}

/** 「12分前」。出してからの経過。 */
function elapsedLabel(at: Date, now: Date): string {
  const elapsed = now.getTime() - at.getTime();
  return elapsed < 60_000 ? "たった今" : `${durationLabel(elapsed)}前`;
}

/** ミリ秒を「2時間58分」「9時間」「48分」の形にする。日をまたぐぶんは「◯日」で丸める。 */
function durationLabel(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}分`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest === 0 ? `${hours}時間` : `${hours}時間${rest}分`;
  }

  return `${Math.floor(hours / 24)}日`;
}

/**
 * 日付と時刻の表示。**日本時間で作る**（#79の `jstDateKey()`・#101の `jstParts()` と同じ理由。
 * サーバーのタイムゾーンで作ると、UTCで動く本番だけ日付がずれる）。
 *
 * 今日のぶんは時刻だけ、昨日は「昨日」、それより前は日付を添える。
 */
function stampLabel(at: Date, now: Date): string {
  if (isSameJstDate(at, now)) return timeLabel(at);

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (isSameJstDate(at, yesterday)) return `昨日 ${timeLabel(at)}`;

  return `${jstFormat(at, { month: "numeric", day: "numeric" })} ${timeLabel(at)}`;
}

function timeLabel(at: Date | null): string {
  if (!at) return "";
  return jstFormat(at, { hour: "2-digit", minute: "2-digit" });
}

function jstFormat(at: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", ...options }).format(at);
}

function isSameJstDate(a: Date, b: Date): boolean {
  const key = (at: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);

  return key(a) === key(b);
}
