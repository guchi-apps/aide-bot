/**
 * `public/sw.js` の `safeTarget()` が、`src/lib/notice-url.ts` の `safeNoticeUrl()` と
 * 同じ結果を返すこと（#248）。
 *
 * `sw.js` はビルドを通らない素のJSでimportできないため、同じ判定を手で書き写している
 * （#137）。片方だけ直すと、Service Workerだけが穴を持ったまま残る——実際に #137 で
 * `/\evil.example.com` の対策が片方にしか入らず、#140 まで気付かなかった。
 * ここでは `sw.js` を読み込んで関数を取り出し、両方に同じ入力を流して結果を突き合わせる。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { safeNoticeUrl } from "@/lib/notice-url";

import { NOTICE_URL_CASES, originEscapeCorpus } from "./cases.ts";

const SW_PATH = fileURLToPath(new URL("../public/sw.js", import.meta.url));

/** `sw.js` を実行して、判定だけを取り出す。イベントの登録は受け流す。 */
function loadServiceWorker() {
  const context = vm.createContext({
    // 判定は `URL` 以外に触れない。トップレベルで呼ばれる `self.addEventListener` だけ受け流す。
    self: { addEventListener() {}, location: { origin: "https://app.example" } },
    URL,
  });
  vm.runInContext(readFileSync(SW_PATH, "utf8"), context, { filename: SW_PATH });

  const safeTarget = vm.runInContext("typeof safeTarget === 'function' ? safeTarget : null", context);
  assert.ok(safeTarget, "public/sw.js から safeTarget() が見つからない（改名した場合はこのテストも直す）");
  const fallback = vm.runInContext("FALLBACK.url", context);
  assert.equal(typeof fallback, "string");

  return { safeTarget: safeTarget as (value: unknown) => string, fallback: fallback as string };
}

const sw = loadServiceWorker();

/** `safeNoticeUrl()` は落とすと null、`safeTarget()` は既定の遷移先を返す。 */
function expectedTarget(value: unknown): string {
  return safeNoticeUrl(value as string | null | undefined) ?? sw.fallback;
}

describe("public/sw.js の safeTarget()", () => {
  it("既定の遷移先はアプリのルート", () => {
    assert.equal(sw.fallback, "/");
  });

  for (const [input, expected, why] of NOTICE_URL_CASES) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected ?? sw.fallback)}（${why}）`, () => {
      assert.equal(sw.safeTarget(input), expected ?? sw.fallback);
    });
  }

  it("表の全入力で safeNoticeUrl() と結果が一致する", () => {
    for (const [input] of NOTICE_URL_CASES) {
      assert.equal(sw.safeTarget(input), expectedTarget(input), JSON.stringify(input));
    }
  });

  it("1文字・2文字の組み合わせの総当たりでも safeNoticeUrl() と結果が一致する", () => {
    const corpus = originEscapeCorpus();
    assert.ok(corpus.length > 10_000, "入力が少なすぎる");

    for (const value of corpus) {
      assert.equal(sw.safeTarget(value), expectedTarget(value), JSON.stringify(value));
    }
  });

  it("スキームのある入力（前後に空白・制御文字が混ざるもの含む）でも一致する", () => {
    const schemes = ["javascript:", "JavaScript:", "data:", "vbscript:", "file:", "ftp:", "http://", "https://"];
    const noise = ["", " ", "\t", "\n", "\r", "\u0000", "\u007f", " ", "﻿"];

    for (const scheme of schemes) {
      for (const before of noise) {
        for (const inner of noise) {
          for (const after of noise) {
            const value = `${before}${scheme.slice(0, 4)}${inner}${scheme.slice(4)}example.com/a${after}`;
            assert.equal(sw.safeTarget(value), expectedTarget(value), JSON.stringify(value));
          }
        }
      }
    }
  });
});
