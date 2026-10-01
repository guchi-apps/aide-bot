"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * 秘書の一言に出すものを、待っている間は一定の間隔で入れ替える（#93・#101）。
 *
 * 問い合わせ自体は「書く」画面の声かけ（`@/components/chat/use-nudge`。3分ごと）が持ち、ここは
 * 届いた中身を輪にして送るだけ。サーバー側（`resolveNotice()`）が「10分に1回まで」
 * 「未読が0件なら叩かない」を守る。
 *
 * 同じ応答に、待機中に回す「ひとりごと」（`resolveChatter()`）も乗ってくる。**取得口を
 * 分けないのは、問い合わせ1回ごとにmiddlewareの `auth.getUser()` がもう1往復増えるため。**
 */

export type NoticeBubble = {
  id: string;
  text: string;
  urgent: boolean;
  /** 選ばれた時刻（ISO）。吹き出しの末尾に「いつ時点か」を出す。 */
  shownAt: string;
  /**
   * 押したときに開く先（#137）。積む側が付けた元データへのリンクで、無ければnull。
   * サーバー側（`resolveNotice()`）が `safeNoticeUrl()` を通した値だけを載せる。
   */
  url: string | null;
};

/**
 * 仕入れた話題（#144）の1件。サーバー側（`topicsForBubble()`）が返す形をそのまま持つ。
 */
export type TopicBubble = {
  id: string;
  /** 秘書が話題として振る一言。吹き出しに出るのはこれ。 */
  lead: string;
  title: string;
  /** 出典の記事。サーバー側で `safeNoticeUrl()` を通した値だけが載る。 */
  url: string | null;
  category: string;
};

/**
 * 待っている間に吹き出しへ出す1枠。お知らせ・ひとりごと・呼びかけ・話題が同じ輪に並ぶ。
 *
 * `call` は既定の「どうぞ、話しかけてください」。**輪の中に必ず1つ入れる**——初めて開いた人に
 * 「マイクを押せば始まる」ことを伝える枠で、ひとりごとが1件も取れなかった回にはこれだけが残る。
 */
export type BubbleLine =
  | { kind: "notice"; notice: NoticeBubble }
  | { kind: "chatter"; text: string }
  | { kind: "topic"; topic: TopicBubble }
  | { kind: "call" };

/**
 * ひとりごとを次の1件へ送るまでの時間（#101）。
 *
 * **入れ替わりは問い合わせと関係なく画面の中だけで進む。** 手元にある数件を順に回すだけなので、
 * ここを短くしても通信もモデルの呼び出しも増えない。短すぎると視界の端でちらつき、長すぎると
 * 「止まっている」ように見えるので、読み終えて少し置ける長さにしてある。
 */
const CHATTER_ROTATE_MS = 25 * 1000;

/**
 * お知らせを出しておく時間。ひとりごとより長く置く。
 *
 * お知らせは「一度だけ選ばれた、いま伝えたいこと」なので、ひとりごとと同じ速さで流すと
 * 読み終える前に消える。**急ぎ（`urgent`）のときは回転そのものを止める**（下記）。
 */
const NOTICE_HOLD_MS = 60 * 1000;

/**
 * 話題（#144）を出しておく時間。ひとりごとより少し長く、お知らせより短い。
 *
 * 話題の一言は「〜だそうです。〜ですか」と2文になりがちで、25秒では読み終える前に流れる。
 * お知らせと同じ60秒にはしない——ニュースは用件ではなく、長く居座ると用件の方が薄まる。
 */
const TOPIC_HOLD_MS = 35 * 1000;

/** 輪の中で話題を差し込み始める位置と、話題どうしの間隔（ひとりごとを1枠はさむ）。 */
const TOPIC_RING_START = 3;
const TOPIC_RING_STEP = 2;

/**
 * `/api/notices/current` の応答のうち、吹き出しの輪に使うぶん。
 *
 * 「書く」画面（`@/components/chat/secretary-line`）が、声かけ（#278）の問い合わせ
 * （`@/components/chat/use-nudge`）の応答をそのまま受け取る。口を2本にすると、問い合わせ1回ごとに
 * `auth.getUser()` の往復が増える。
 */
export type BubblePayload = { notice: NoticeBubble | null; chatter: string[]; topics: TopicBubble[] };

export const EMPTY_BUBBLE_PAYLOAD: BubblePayload = { notice: null, chatter: [], topics: [] };

type Payload = BubblePayload;

/**
 * 前回と同じ中身か。
 *
 * 3分ごとの問い合わせは**ほとんどの回で同じものを返す。** そのたびに新しいオブジェクトを
 * 入れると輪が作り直され、いま出している一言の残り時間が毎回25秒に戻る（＝入れ替わりが
 * 止まって見える回ができる）。
 */
export function samePayload(a: Payload, b: Payload): boolean {
  return (
    a.notice?.id === b.notice?.id &&
    a.notice?.text === b.notice?.text &&
    a.notice?.shownAt === b.notice?.shownAt &&
    a.notice?.url === b.notice?.url &&
    a.chatter.length === b.chatter.length &&
    a.chatter.every((line, index) => line === b.chatter[index]) &&
    a.topics.length === b.topics.length &&
    a.topics.every((topic, index) => topic.id === b.topics[index]?.id && topic.lead === b.topics[index]?.lead)
  );
}

/**
 * 届いた中身を輪にして、一定の間隔で1枠ずつ送る（#279で問い合わせから切り出した）。
 *
 * 「書く」画面の秘書の一言（`SecretaryLine`）が使う輪。送る間隔・差し込む位置・急ぎのときに止める
 * ことをここに置く。
 */
export function useBubbleRing(payload: BubblePayload): BubbleLine | null {
  const [step, setStep] = useState(0);

  /**
   * 回す輪。お知らせは先頭に置き、ひとりごとと同じ輪の中で繰り返し出す。
   *
   * 出したきりにしないのは、お知らせが選ばれた回だけ吹き出しが1時間固まって、
   * 「常に何か話している」が止まってしまうため（#93の表示の上限はサーバー側に残る）。
   */
  const ring = useMemo<BubbleLine[]>(() => {
    const lines: BubbleLine[] = payload.chatter.map((text) => ({ kind: "chatter", text }));
    // 呼びかけは2枠目に置く。先頭にすると、開いた瞬間はいつも同じ文言になる。
    lines.splice(Math.min(1, lines.length), 0, { kind: "call" });
    // 話題（#144）は輪の後ろの方に、ひとりごとを1枠はさんで差し込む。先頭側に置かないのは、
    // 開いた瞬間に出るのはお知らせか呼びかけであるべきで、ニュースが用件より前に出ると
    // 「用件と雑談を同じ場所で交互に出す」ことの悪い側（用件が埋もれる）が先に立つため。
    payload.topics.forEach((topic, index) => {
      const at = Math.min(lines.length, TOPIC_RING_START + index * TOPIC_RING_STEP);
      lines.splice(at, 0, { kind: "topic", topic });
    });
    if (payload.notice) lines.unshift({ kind: "notice", notice: payload.notice });
    return lines;
  }, [payload]);

  const current = ring.length === 0 ? null : ring[step % ring.length];

  useEffect(() => {
    if (!current || ring.length <= 1) return;
    // 急ぎのお知らせは流さない。読み終える前に次のひとりごとへ移ると、
    // いちばん伝えたいものだけが見逃される。
    if (current.kind === "notice" && current.notice.urgent) return;

    const delay =
      current.kind === "notice" ? NOTICE_HOLD_MS : current.kind === "topic" ? TOPIC_HOLD_MS : CHATTER_ROTATE_MS;
    const timer = setTimeout(() => setStep((value) => value + 1), delay);

    return () => clearTimeout(timer);
  }, [current, ring.length]);

  return current;
}
