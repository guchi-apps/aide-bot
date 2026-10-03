/**
 * 通知の種類（#488）。**クライアントからもimportする**ので、Prismaやweb-pushは持ち込まない
 * （DBを引く側は `kinds-server.ts`）。
 *
 * キーは `NotificationLog.kind` と同じ文字列にしてある。オフにした種類のキーを
 * `User.pushDisabledKinds` へカンマ区切りで持つ（空文字＝全部オン）。種類ごとに列を足すと、
 * 種類が増えるたびにマイグレーションが要る。
 */

export const PUSH_KINDS = [
  "morning-briefing",
  "morning-topics",
  "urgent-notice",
  "proactive-suggestion",
  "scheduled-push",
] as const;

export type PushKind = (typeof PUSH_KINDS)[number];

export type PushKindInfo = {
  label: string;
  hint: string;
  when: string;
  /** 見本の通知。本物と同じタイトル・遷移先にして、届き方を確かめられるようにする。 */
  sample: { title: string; body: string; url: string };
};

export const PUSH_KIND_INFO: Record<PushKind, PushKindInfo> = {
  "morning-briefing": {
    label: "朝の見通し",
    hint: "その日の予定・天気・部屋やシステムの状況。知らせることが無い日は届きません。",
    when: "毎日、設定した時刻",
    sample: {
      title: "今日の見通し",
      body: "（見本）今日は午後から雨です。15時に打ち合わせがあります。",
      url: "/",
    },
  },
  "morning-topics": {
    label: "朝のニュース",
    hint: "朝の見通しの時刻に、溜まっている話題の見出しを届けます。",
    when: "朝の見通しと同じ時刻",
    sample: {
      title: "今日のニュース",
      body: "（見本）注目の話題が3件あります。",
      url: "/",
    },
  },
  "urgent-notice": {
    label: "急ぎのお知らせ",
    hint: "他のアプリから「急ぎ」で積まれた用件を、その場で届けます。",
    when: "届いた直後",
    sample: {
      title: "急ぎのお知らせ",
      body: "（見本）急ぎの用件が届いたときは、このように知らせます。",
      url: "/",
    },
  },
  "proactive-suggestion": {
    label: "先回りの提案",
    hint: "「今ならできる」ことを秘書から。種類や静かな時間帯は下の設定で決めます。",
    when: "条件に合ったとき（上限あり）",
    sample: {
      title: "先回りの提案",
      body: "（見本）土曜の午後が空いています。やりたいことを一緒に選びませんか。",
      url: "/",
    },
  },
  "scheduled-push": {
    label: "定時のお知らせ",
    hint: "話題の画面で決めた曜日・時刻に、ニュースの見出しを届けます。",
    when: "話題の画面で設定した時刻",
    sample: {
      title: "定時のお知らせ（話題）",
      body: "（見本）見出しがここに並びます。",
      url: "/topics",
    },
  },
};

export function isPushKind(value: unknown): value is PushKind {
  return typeof value === "string" && (PUSH_KINDS as readonly string[]).includes(value);
}

/** 保存された文字列を、オフの種類の集合へ。知らない名前は捨てる（書き換えられた値で壊れない）。 */
export function parseDisabledKinds(stored: string | null | undefined): Set<PushKind> {
  const result = new Set<PushKind>();
  for (const part of (stored ?? "").split(",")) {
    const key = part.trim();
    if (isPushKind(key)) result.add(key);
  }
  return result;
}

/** 並びはPUSH_KINDSの順に揃える（同じ集合なら同じ文字列になる）。 */
export function serializeDisabledKinds(disabled: ReadonlySet<PushKind>): string {
  return PUSH_KINDS.filter((kind) => disabled.has(kind)).join(",");
}
