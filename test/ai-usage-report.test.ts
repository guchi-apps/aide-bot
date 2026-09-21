/**
 * ops-dashboardの「アプリ別のAI利用」へ返す使用量の組み立てと、Bearerの検証（#297）。
 *
 * **応答の形はops-dashboard側（`src/lib/ai-app-usage/parse.ts`）の検証が正で、1行でも
 * 違えば応答全体が「取得不可」になる。** ここでは、その検証と同じ規則（`isAcceptedByDashboard`）を
 * 写して、組み立てた応答がすべて通ることを確かめる。向こうの規則が変わったらここも直すこと。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAiUsageReport, type UsageGroup } from "@/lib/ai-usage-report";
import { hasValidBearer } from "@/lib/bearer-auth";
import { UNKNOWN_FEATURE_LABEL, USAGE_FEATURE_LABELS, usageFeatureLabel } from "@/lib/usage-feature";

const group = (overrides: Partial<UsageGroup>): UsageGroup => ({
  feature: "chat",
  model: "gpt-5.6-sol",
  calls: 1,
  inputTokens: 100,
  outputTokens: 10,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  ...overrides,
});

/** ops-dashboardの `toTotals()` / `parseAiAppUsageResponse()` と同じ規則。 */
function isAcceptedByDashboard(data: unknown): boolean {
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const totals = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const raw = value as Record<string, unknown>;
    if (!count(raw.calls) || !count(raw.inputTokens)) return false;
    for (const key of ["outputTokens", "cacheReadTokens", "cacheWriteTokens"]) {
      if (raw[key] !== undefined && raw[key] !== null && !count(raw[key])) return false;
    }
    return true;
  };

  if (!data || typeof data !== "object") return false;
  const features = (data as { features?: unknown }).features;
  if (!Array.isArray(features)) return false;

  return features.every((feature) => {
    if (!feature || typeof feature !== "object") return false;
    const raw = feature as Record<string, unknown>;
    return (
      typeof raw.label === "string" &&
      raw.label.length > 0 &&
      typeof raw.model === "string" &&
      raw.model.length > 0 &&
      totals(raw.last24h) &&
      totals(raw.last7d)
    );
  });
}

describe("buildAiUsageReport", () => {
  it("呼び出しが無ければ features は空（エラーにしない）", () => {
    const report = buildAiUsageReport({ last24h: [], last7d: [] });
    assert.deepEqual(report, { features: [] });
    assert.ok(isAcceptedByDashboard(report));
  });

  it("機能×モデルごとに1行で、期間ごとの数を持つ。inputTokensはキャッシュ外のまま", () => {
    const report = buildAiUsageReport({
      last24h: [group({ calls: 2, inputTokens: 300, outputTokens: 20, cacheReadTokens: 8960 })],
      last7d: [group({ calls: 9, inputTokens: 1500, outputTokens: 90, cacheReadTokens: 40000 })],
    });

    assert.deepEqual(report.features, [
      {
        label: "チャット",
        model: "gpt-5.6-sol",
        last24h: { calls: 2, inputTokens: 300, outputTokens: 20, cacheReadTokens: 8960, cacheWriteTokens: 0 },
        last7d: { calls: 9, inputTokens: 1500, outputTokens: 90, cacheReadTokens: 40000, cacheWriteTokens: 0 },
      },
    ]);
  });

  it("同じ機能でモデルを切り替えていれば2行に分ける", () => {
    const report = buildAiUsageReport({
      last24h: [],
      last7d: [group({ model: "gpt-5.6-sol" }), group({ model: "gpt-5.6-luna" })],
    });
    assert.deepEqual(
      report.features.map((row) => [row.label, row.model]),
      [
        ["チャット", "gpt-5.6-luna"],
        ["チャット", "gpt-5.6-sol"],
      ],
    );
  });

  it("同じモデル名でも機能が違えば別の行（相談・お知らせ・話題）", () => {
    const report = buildAiUsageReport({
      last24h: [],
      last7d: [
        group({ feature: "topic", model: "gpt-5.6-luna" }),
        group({ feature: "notice", model: "gpt-5.6-luna" }),
        group({ feature: "chat", model: "gpt-5.6-luna" }),
      ],
    });
    assert.deepEqual(
      report.features.map((row) => row.label),
      ["チャット", "お知らせの選定", "話題の仕入れ"],
    );
  });

  it("24時間に呼び出しが無い行は0で埋める", () => {
    const report = buildAiUsageReport({ last24h: [], last7d: [group({ calls: 4 })] });
    assert.deepEqual(report.features[0].last24h, {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    assert.ok(isAcceptedByDashboard(report));
  });

  it("機能の記録が無い行（空文字・表に無い値）は1つの「その他」へ足す", () => {
    const report = buildAiUsageReport({
      last24h: [],
      last7d: [
        group({ feature: "", calls: 3, inputTokens: 30 }),
        group({ feature: "removed_feature", calls: 2, inputTokens: 20 }),
      ],
    });
    assert.equal(report.features.length, 1);
    assert.equal(report.features[0].label, UNKNOWN_FEATURE_LABEL);
    assert.equal(report.features[0].last7d.calls, 5);
    assert.equal(report.features[0].last7d.inputTokens, 50);
  });

  it("並びは機能の表の順で、その他は末尾。入力の順序に依らない", () => {
    const groups = [
      group({ feature: "", model: "a" }),
      group({ feature: "home_profile" }),
      group({ feature: "briefing" }),
      group({ feature: "chat" }),
    ];
    const forward = buildAiUsageReport({ last24h: [], last7d: groups });
    const backward = buildAiUsageReport({ last24h: [], last7d: [...groups].reverse() });

    assert.deepEqual(forward, backward);
    assert.deepEqual(
      forward.features.map((row) => row.label),
      ["チャット", "朝の見通し", "自宅情報の取り込み", UNKNOWN_FEATURE_LABEL],
    );
  });

  it("7日間が24時間を下回る取りこぼしは24時間に揃える（行は落とさない）", () => {
    const report = buildAiUsageReport({
      last24h: [group({ calls: 3, inputTokens: 500 })],
      last7d: [group({ calls: 2, inputTokens: 300 })],
    });
    assert.equal(report.features[0].last24h.calls, 3);
    assert.equal(report.features[0].last7d.calls, 3);
    assert.equal(report.features[0].last7d.inputTokens, 500);
  });

  it("組み立てた応答はops-dashboardの検証を通り、本文などの余計な項目を含まない", () => {
    const report = buildAiUsageReport({
      last24h: [group({}), group({ feature: "notice", model: "gpt-5.6-luna" })],
      last7d: [group({ calls: 5 }), group({ feature: "notice", model: "gpt-5.6-luna", calls: 7 })],
    });
    assert.ok(isAcceptedByDashboard(report));

    for (const row of report.features) {
      assert.deepEqual(Object.keys(row).sort(), ["label", "last24h", "last7d", "model"]);
      assert.deepEqual(Object.keys(row.last7d).sort(), [
        "cacheReadTokens",
        "cacheWriteTokens",
        "calls",
        "inputTokens",
        "outputTokens",
      ]);
    }
  });
});

describe("usageFeatureLabel", () => {
  it("すべての機能に名前があり、名前は重ならない", () => {
    const labels = Object.values(USAGE_FEATURE_LABELS);
    assert.equal(new Set(labels).size, labels.length);
    assert.ok(labels.every((label) => label.length > 0 && label !== UNKNOWN_FEATURE_LABEL));
  });

  it("Object.prototypeの名前を機能として読まない", () => {
    assert.equal(usageFeatureLabel("constructor"), UNKNOWN_FEATURE_LABEL);
    assert.equal(usageFeatureLabel("toString"), UNKNOWN_FEATURE_LABEL);
  });
});

describe("hasValidBearer", () => {
  it("値が一致するときだけ通る", () => {
    assert.equal(hasValidBearer("Bearer secret-token", "secret-token"), true);
    assert.equal(hasValidBearer("Bearer secret-token!", "secret-token"), false);
    assert.equal(hasValidBearer("Bearer secret", "secret-token"), false);
  });

  it("ヘッダーが無い・Bearerでない・値が空なら通らない", () => {
    assert.equal(hasValidBearer(null, "secret-token"), false);
    assert.equal(hasValidBearer("", "secret-token"), false);
    assert.equal(hasValidBearer("secret-token", "secret-token"), false);
    assert.equal(hasValidBearer("Basic secret-token", "secret-token"), false);
    assert.equal(hasValidBearer("Bearer ", "secret-token"), false);
  });

  it("シークレットが未設定（undefined・空文字）なら、何を送っても通らない", () => {
    assert.equal(hasValidBearer("Bearer ", ""), false);
    assert.equal(hasValidBearer("Bearer x", ""), false);
    assert.equal(hasValidBearer("Bearer x", undefined), false);
    assert.equal(hasValidBearer(null, undefined), false);
  });
});
