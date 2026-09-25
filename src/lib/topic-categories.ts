/**
 * 話題（#144）として仕入れるニュースの種類。**利用者が追加・編集・削除できる**（#345）。
 *
 * **このモジュールはクライアントコンポーネントからもimportする**（「話題」ページの管理部品）。
 * PrismaやCodex CLIの起動処理に触れるものを持ち込まないこと（`chat-model.ts` と同じ分け方。
 * DBの読み書きは `topic-category-store.ts`、仕入れそのものは `topics.ts`）。
 *
 * 種類は利用者ごとの行（`TopicCategory`）に持つ。Cookieにしないのは、仕入れが利用者の画面とは
 * 別のタイミング（応答後のバックグラウンド）で走り、そこでも読む必要があるため（`briefingHour`
 * と同じ理由）。`Topic.category` には種類の `id`（DBの `key`）を入れ、外部キーにはしない。
 */

/** 画面・仕入れの両方が扱う1件。 */
export type TopicCategory = {
  /** `Topic.category` に入る識別子。作ったあと変えない。 */
  id: string;
  /** 画面に出す名前。 */
  label: string;
  /** チップに出す短い名前。 */
  short: string;
  /** 仕入れのプロンプトで、この種類として何を集めるかを伝える文。 */
  scope: string;
  /** 仕入れの対象か。外している間も種類そのものは残る。 */
  enabled: boolean;
};

/** 種類の数の上限。1種類ごとに仕入れる記事が増え、1回の検索が重くなる（`topics.ts`）。 */
export const MAX_TOPIC_CATEGORIES = 8;

export const TOPIC_LABEL_MAX = 30;
export const TOPIC_SHORT_MAX = 12;
export const TOPIC_SCOPE_MAX = 200;

/** 初回に投入する種類（#144から続く3種類）。`id` は既存の `Topic.category` と同じ値。 */
export const DEFAULT_TOPIC_CATEGORIES: Omit<TopicCategory, "enabled">[] = [
  {
    id: "general",
    label: "世の中のこと",
    short: "世の中",
    scope: "政治・経済・社会の主な出来事（日本のもの、および日本に影響する海外のもの）",
  },
  {
    id: "life",
    label: "暮らしに関わること",
    short: "暮らし",
    scope: "値上げ・制度や手続きの変更・災害や気象・交通など、日本での暮らしに直接関わること",
  },
  {
    id: "tech",
    label: "技術とAI",
    short: "技術",
    scope: "ソフトウェア開発・AI・IT業界の動向（新しいリリース・大きな変更・障害など）",
  },
];

/**
 * 移行元（`User.topicCategories` のカンマ区切り）を、初期の3種類のオン・オフへ均す。
 * **空文字は「何も仕入れない」**（利用者がすべて外した状態を尊重する）。
 */
export function initialTopicCategories(legacy: string | null | undefined): TopicCategory[] {
  const chosen = new Set((legacy ?? "general,life,tech").split(",").map((part) => part.trim()));
  return DEFAULT_TOPIC_CATEGORIES.map((category) => ({ ...category, enabled: chosen.has(category.id) }));
}

/** 新しい種類の識別子。VarChar(20)に収まる（`c_` ＋ 英数12文字）。 */
export function newTopicCategoryId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "c_";
  for (let i = 0; i < 12; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return id;
}

/** 空白・改行の連なりを1つの半角スペースへ畳み、前後を落とす（プロンプトへ入る文字列なので改行を持ち込ませない）。 */
function tidy(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\p{Cc}\s]+/gu, " ").trim() : "";
}

export type TopicCategoryFields = { label: string; short: string; scope: string };

/**
 * 画面・APIから受け取った入力を検証する。**利用者が書き換えられる値**なので、型・長さ・改行を
 * ここで揃える（`short` が空なら `label` の先頭から作る）。
 */
export function validateTopicCategoryInput(
  raw: unknown,
): { ok: true; value: TopicCategoryFields } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "入力の形式が正しくありません。" };
  const record = raw as Record<string, unknown>;

  const label = tidy(record.label);
  const scope = tidy(record.scope);
  if (label === "") return { ok: false, error: "名前を入力してください。" };
  if (label.length > TOPIC_LABEL_MAX) return { ok: false, error: `名前は${TOPIC_LABEL_MAX}文字以内にしてください。` };
  if (scope === "") return { ok: false, error: "集める内容を入力してください。" };
  if (scope.length > TOPIC_SCOPE_MAX) {
    return { ok: false, error: `集める内容は${TOPIC_SCOPE_MAX}文字以内にしてください。` };
  }

  const short = tidy(record.short) || label.slice(0, TOPIC_SHORT_MAX);
  if (short.length > TOPIC_SHORT_MAX) {
    return { ok: false, error: `短い名前は${TOPIC_SHORT_MAX}文字以内にしてください。` };
  }

  return { ok: true, value: { label, short, scope } };
}

/** チップに出す短い名前。削除された種類・知らない値は「その他」。 */
export function topicCategoryShort(categories: readonly TopicCategory[], id: string): string {
  return categories.find((category) => category.id === id)?.short ?? "その他";
}
