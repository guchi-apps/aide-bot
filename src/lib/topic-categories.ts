/**
 * 話題（#144）として仕入れるニュースの種類。
 *
 * **このモジュールはクライアントコンポーネントからもimportする**（「話題」ページの
 * 種類を選ぶ部品）。PrismaやCodex CLIの起動処理に触れるものを持ち込まないこと
 * （`chat-model.ts` と同じ分け方。仕入れそのものは `src/lib/topics.ts`）。
 *
 * 選んだ種類は `User.topicCategories` にカンマ区切りで持つ。Cookieにしないのは、仕入れが
 * 利用者の画面とは別のタイミング（応答後のバックグラウンド）で走り、そこでも読む必要が
 * あるため（`briefingHour` と同じ理由）。
 */

export type TopicCategoryId = "general" | "life" | "tech";

export type TopicCategory = {
  id: TopicCategoryId;
  /** 画面に出す名前。 */
  label: string;
  /** 吹き出しや一覧のチップに出す短い名前。 */
  short: string;
  /** 画面に出す一言。 */
  hint: string;
  /** 仕入れのプロンプトで、この種類として何を集めるかを伝える文。 */
  scope: string;
};

/** 選べる種類。画面の並びもこの順。 */
export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: "general",
    label: "世の中のこと",
    short: "世の中",
    hint: "政治・経済・社会の主な出来事",
    scope: "政治・経済・社会の主な出来事（日本のもの、および日本に影響する海外のもの）",
  },
  {
    id: "life",
    label: "暮らしに関わること",
    short: "暮らし",
    hint: "値上げ・制度の変更・災害・交通",
    scope: "値上げ・制度や手続きの変更・災害や気象・交通など、日本での暮らしに直接関わること",
  },
  {
    id: "tech",
    label: "技術とAI",
    short: "技術",
    hint: "ソフトウェア開発・AIの動向",
    scope: "ソフトウェア開発・AI・IT業界の動向（新しいリリース・大きな変更・障害など）",
  },
];

/** 何も選んでいないときの種類。新しい利用者はすべて入で始まる（DBの既定値と揃える）。 */
export const DEFAULT_TOPIC_CATEGORIES: TopicCategoryId[] = ["general", "life", "tech"];

const KNOWN_IDS = new Set<string>(TOPIC_CATEGORIES.map((category) => category.id));

export function isTopicCategoryId(value: unknown): value is TopicCategoryId {
  return typeof value === "string" && KNOWN_IDS.has(value);
}

/**
 * DBのカンマ区切りの値を種類の一覧に均す。
 *
 * 知らない値は落とし、定義の順に並べ直す。**空文字は「何も仕入れない」**なので空の配列を返す
 * （既定へ戻さない——利用者がすべて外した状態を尊重する）。`null` は列が無かった頃の
 * 行ではなく（既定値があるので存在しない）、呼び出し側の都合で来る値なので既定にする。
 */
export function parseTopicCategories(value: string | null | undefined): TopicCategoryId[] {
  if (value === null || value === undefined) return [...DEFAULT_TOPIC_CATEGORIES];

  const chosen = new Set(value.split(",").map((part) => part.trim()));
  return TOPIC_CATEGORIES.map((category) => category.id).filter((id) => chosen.has(id));
}

/** 画面から受け取った配列をDBの値へ。知らない値は落とし、定義の順に並べる。 */
export function serializeTopicCategories(values: unknown): string {
  if (!Array.isArray(values)) return "";

  const chosen = new Set(values.filter(isTopicCategoryId));
  return TOPIC_CATEGORIES.map((category) => category.id)
    .filter((id) => chosen.has(id))
    .join(",");
}

/** チップに出す短い名前。知らない値（古い行など）はそのまま出す。 */
export function topicCategoryShort(id: string): string {
  return TOPIC_CATEGORIES.find((category) => category.id === id)?.short ?? id;
}
