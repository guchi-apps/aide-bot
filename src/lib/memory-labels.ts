/**
 * 継続記憶（#323）の名前と表示用の定数。**クライアントコンポーネントからもimportする**ので、
 * `node:crypto` などサーバー専用のものを持ち込まない（判定の本体は `memory-rule.ts`）。
 */

export type MemoryKindName = "WISH" | "DECISION" | "ONGOING";
export type MemoryConfidenceName = "HIGH" | "MEDIUM" | "LOW";
export type MemoryStatusName = "CANDIDATE" | "CONFIRMED" | "DISMISSED" | "FORGOTTEN";

export const MEMORY_KIND_LABELS: Record<MemoryKindName, string> = {
  WISH: "行きたい・やりたい",
  DECISION: "決めたこと",
  ONGOING: "進行中の用件",
};

export const MEMORY_CONFIDENCE_LABELS: Record<MemoryConfidenceName, string> = {
  HIGH: "確度: 高",
  MEDIUM: "確度: 中",
  LOW: "確度: 低",
};

/** Notionの状態を確認し直す間隔。これより古い確認は「未確認」として扱う。 */
export const NOTION_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
