"use client";

import { OpenLink, noticeStamp } from "@/components/voice/speech-bubble";
import { type BubblePayload, useBubbleRing } from "@/components/voice/use-notice";
import { cn } from "@/lib/utils";

/**
 * 「書く」画面で、入力欄の上に出る秘書の一言（#279）。
 *
 * **中身は「話す」画面の吹き出し（#93・#101・#144）と同じ輪**（`useBubbleRing()`）で、
 * お知らせ・ひとりごと・話題が順に入れ替わる。形だけを、記録の流れの下に収まる1行にしてある。
 *
 * **問い合わせはここでは持たない。** 声かけ（#278）の問い合わせ（`./use-nudge`）が同じ
 * `/api/notices/current` を叩いており、その応答に輪の材料も全部載っているので、持ち主
 * （`ChatPanel`）が受け取って `payload` で渡す。**ここで `useBubbleLine()` を呼ぶと、同じ口を
 * 2本で叩く**——問い合わせ1回ごとに `auth.getUser()` の往復が増え、既定の画面で常にそうなる。
 *
 * **#279で既定が「書く」になった以上、この出し先が無いと成り立たない。** `/api/notices/current`
 * を叩いていたのは「話す」画面の輪だけで（#278の声かけは `?since=` を付けて同じ口へ相乗りする）、
 * そこには
 *
 * - お知らせの選定（#93。モデルが1件選んで言い直す）
 * - 待っている間のひとりごと（#101）
 * - **ニュースの仕入れ（#144）の唯一の起点**（応答後の `refreshTopicsIfStale()`）
 *
 * がぶら下がっている。**「叩くが出さない」にはできない**——`resolveNotice()` は選んだ時点で
 * `shownAt` を書くので、出さずに叩くと**誰も読んでいないのにお知らせが消費される**
 * （CLAUDE.mdの#114が一覧について名指しで禁じている形）。
 *
 * - **呼びかけ（`call`）の枠は出さない。** 「どうぞ、話しかけてください」は入力欄の
 *   プレースホルダーと同じことを言っており、出すと常時1行ぶん記録が削られる
 * - **読み上げソフトへ知らせるのはお知らせだけ**（#101と同じ扱い）。ひとりごと・話題が
 *   25秒ごとに読み上げへ割り込むと、書いている手が止まる
 * - **面全体をリンクにしない**（#137）。押せるのは末尾の「開く」だけ
 */
export function SecretaryLine({ payload }: { payload: BubblePayload }) {
  const line = useBubbleRing(payload);

  if (!line || line.kind === "call") return null;

  const notice = line.kind === "notice" ? line.notice : null;
  const topic = line.kind === "topic" ? line.topic : null;
  const text = notice ? notice.text : topic ? topic.lead : line.kind === "chatter" ? line.text : "";
  const urgent = notice?.urgent ?? false;
  // 時刻はお知らせにだけ出す。話題に「いつ時点か」の印を付けると用件に見える。
  const stamp = notice ? noticeStamp(notice.shownAt) : "";

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl" aria-live={notice ? "polite" : "off"}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-[14px] border px-3 py-2 text-[0.8125rem] leading-relaxed",
          urgent
            ? "border-accent/40 bg-accent-surface font-bold text-accent"
            : "border-border bg-surface text-foreground",
        )}
      >
        {urgent && (
          <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-accent-foreground">
            急ぎ
          </span>
        )}

        {/* 話題（#144）の印。用件（accent）とは別の色にして、ニュースが用件に見えないようにする。 */}
        {topic && (
          <span className="shrink-0 rounded-full bg-topic-surface px-2 py-0.5 text-[0.625rem] font-bold tracking-wider text-topic">
            話題
          </span>
        )}

        <span className="min-w-0 flex-1 text-pretty">{text}</span>

        {notice?.url && <OpenLink url={notice.url} />}
        {topic?.url && <OpenLink url={topic.url} />}

        {stamp !== "" && (
          <span
            className={cn(
              "shrink-0 text-[0.6875rem] font-medium tabular-nums",
              urgent ? "text-current opacity-70" : "text-muted",
            )}
          >
            {stamp}
          </span>
        )}
      </div>
    </div>
  );
}
