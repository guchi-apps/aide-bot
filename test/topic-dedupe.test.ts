import assert from "node:assert/strict";
import test from "node:test";

import { groupDuplicateTopics, topicSimilarity } from "../src/lib/topic-dedupe.ts";

const boj = [
  {
    title: "日銀、政策金利を据え置き　追加利上げは慎重に判断",
    summary: "日銀は金融政策決定会合で政策金利の据え置きを決めた。物価と賃金の動向を見極める姿勢を示した。",
  },
  {
    title: "日銀、金利据え置き　総裁は賃金の動向を見極める考え",
    summary: "日銀は金融政策決定会合で政策金利を据え置いた。総裁は物価と賃金の動向を見極めると述べた。",
  },
  {
    title: "政策金利を維持　日銀会合",
    summary: "日銀は政策金利の据え置きを決めた。物価と賃金の動向を見極める。",
  },
];
const gas = {
  title: "今月のガソリン価格、全国平均は1リットル172円",
  summary: "資源エネルギー庁の調査で、レギュラーの全国平均は前週から1円下がった。",
};
const next = {
  title: "Next.js 16.2を公開　ビルド時間を短縮",
  summary: "Vercelは新版を公開した。Turbopackのキャッシュ改善で大規模アプリのビルドが速くなったという。",
};

test("別の媒体が報じた同じ出来事は1件にまとまる", () => {
  const groups = groupDuplicateTopics([...boj, gas]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].primary, boj[0]);
  assert.deepEqual(groups[0].others, [boj[1], boj[2]]);
  assert.equal(groups[1].primary, gas);
});

test("別件はまとめない", () => {
  const groups = groupDuplicateTopics([boj[0], gas, next]);
  assert.equal(groups.length, 3);
  assert.ok(groups.every((group) => group.others.length === 0));
});

test("同じ業界・似た言い回しでも別の出来事なら分ける", () => {
  const other = {
    title: "日銀、国債買い入れの減額計画を公表　来年度も継続",
    summary: "日銀は国債の買い入れを段階的に減らす計画を公表した。市場の混乱を避けるため柔軟に運用する。",
  };
  assert.ok(topicSimilarity(boj[0], other) < 0.5);
  assert.equal(groupDuplicateTopics([boj[0], other]).length, 2);
});

test("入力の並びを保ち、代表は最初に現れた記事", () => {
  const groups = groupDuplicateTopics([gas, boj[1], next, boj[0]]);
  assert.deepEqual(
    groups.map((group) => group.primary),
    [gas, boj[1], next],
  );
  assert.deepEqual(groups[1].others, [boj[0]]);
});

test("表記の揺れ（全角半角・記号・空白）は無視する", () => {
  const a = { title: "Ｎｅｘｔ．ｊｓ １６を公開", summary: "新版が出た" };
  const b = { title: "next.js 16 を公開！", summary: "新版が出た。" };
  assert.equal(topicSimilarity(a, b), 1);
});

test("空・1件・空文字でも落ちない", () => {
  assert.deepEqual(groupDuplicateTopics([]), []);
  assert.equal(groupDuplicateTopics([gas]).length, 1);
  assert.equal(topicSimilarity({ title: "", summary: "" }, gas), 0);
  assert.equal(groupDuplicateTopics([{ title: "", summary: "" }, { title: "", summary: "" }]).length, 2);
});
