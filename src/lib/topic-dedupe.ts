/**
 * 話題（`Topic`。#144）の重複まとめ（#362）。**Prismaに触れない純粋な関数だけ**
 * （境目は `test/topic-dedupe.test.ts` が固定する）。
 *
 * 別の媒体が同じ出来事を報じると、URLが違うので `Topic` には別の行として溜まる。話題の一覧・
 * 吹き出し・定時のお知らせで同じ話が並ばないよう、**見出しと要点の文字の重なり**で同じ出来事を
 * 判定して1件にまとめる。**モデルは呼ばない**（#93・#101の「黙っている間の費用は0円」）。
 * 表示のときにだけまとめ、DBの行は消さない（判定を直せばすぐ反映され、元の記事も辿れる）。
 */

/** 同じ出来事とみなす類似度（文字2つ組のDice係数）の下限。誤ってまとめるより、まとめ損ねる側へ倒す。 */
export const DUPLICATE_THRESHOLD = 0.5;

export type DedupeCandidate = {
  title: string;
  summary: string;
};

export type TopicGroup<T> = {
  /** 表に出す1件。入力の並びで最初に現れたもの（新しい順に渡せば、いちばん新しい記事）。 */
  primary: T;
  /** 同じ出来事を報じている他の記事（入力の並び順）。 */
  others: T[];
};

/** 比べる前に表記の揺れを落とす。全角半角・大小文字・空白と記号を無視する。 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function bigrams(text: string): Set<string> {
  const normalized = normalize(text);
  const set = new Set<string>();
  if (normalized.length === 1) set.add(normalized);
  for (let i = 0; i < normalized.length - 1; i++) set.add(normalized.slice(i, i + 2));
  return set;
}

/** 2つの文字2つ組の集合のDice係数（0〜1）。どちらかが空なら0。 */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** 見出しと要点から見た2件の類似度（0〜1）。 */
export function topicSimilarity(a: DedupeCandidate, b: DedupeCandidate): number {
  return dice(bigrams(`${a.title}${a.summary}`), bigrams(`${b.title}${b.summary}`));
}

/**
 * 同じ出来事の記事を束ねる。**入力の並びを保つ**（グループの並びは代表の並び順）。
 *
 * 比べる相手は各グループの代表だけにする。メンバー全員と比べると、A≒B・B≒Cの連鎖でAとCまで
 * 別件を引き込みうる。
 */
export function groupDuplicateTopics<T extends DedupeCandidate>(items: readonly T[]): TopicGroup<T>[] {
  const groups: { group: TopicGroup<T>; grams: Set<string> }[] = [];

  for (const item of items) {
    const grams = bigrams(`${item.title}${item.summary}`);
    const found = groups.find((entry) => dice(entry.grams, grams) >= DUPLICATE_THRESHOLD);
    if (found) {
      found.group.others.push(item);
    } else {
      groups.push({ group: { primary: item, others: [] }, grams });
    }
  }

  return groups.map((entry) => entry.group);
}
