/**
 * お知らせを積む口の入力検証（#93・#137・#247・#265）。HTTPとMCPが同じ関数を通る。
 *
 * 落とす形の返り値は**利用者（積む側）へ返す文言**で、どの項目を直せばよいかを名指ししている。
 * 項目名と上限が文言から抜けると、呼ぶ側は何を縮めればよいか分からず、そのお知らせは登録されない（#247）。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NoticePriority } from "@prisma/client";

import { NOTICE_BODY_MAX, NOTICE_TITLE_MAX, parseNoticeInput } from "@/lib/notice-ingest";

const valid = {
  email: "me@example.com",
  source: "dayspan",
  kind: "reminder",
  dedupeKey: "event-1",
  body: "あと30分で予定があります",
};

/** 正常な入力の一部を差し替える。 */
function withField(field: string, value: unknown) {
  return { ...valid, [field]: value };
}

function rejected(raw: unknown): string {
  const result = parseNoticeInput(raw);
  assert.equal(typeof result, "string", `受け付けてはいけない入力: ${JSON.stringify(raw)}`);
  return result as string;
}

function accepted(raw: unknown) {
  const result = parseNoticeInput(raw);
  assert.notEqual(typeof result, "string", `受け付けるべき入力: ${JSON.stringify(raw)} → ${result}`);
  return result as Exclude<ReturnType<typeof parseNoticeInput>, string>;
}

describe("parseNoticeInput（必須項目）", () => {
  it("最小の入力を受け付け、省略した項目は既定で埋める", () => {
    const { email, input } = accepted(valid);
    assert.equal(email, "me@example.com");
    assert.deepEqual(input, {
      source: "dayspan",
      kind: "reminder",
      dedupeKey: "event-1",
      title: undefined,
      body: "あと30分で予定があります",
      url: null,
      priority: NoticePriority.NORMAL,
      showAt: null,
      expiresAt: null,
    });
  });

  it("オブジェクトでない入力は落とす", () => {
    for (const raw of [null, undefined, "text", 1, true]) assert.match(rejected(raw), /オブジェクト/);
  });

  for (const field of ["email", "source", "kind", "dedupeKey", "body"]) {
    it(`${field} が無い・空・文字列でないなら、その項目名を挙げて落とす`, () => {
      for (const value of [undefined, null, "", "   ", 1, {}]) {
        assert.match(rejected(withField(field, value)), new RegExp(`^${field} `), JSON.stringify(value));
      }
    });
  }

  it("前後の空白は取り除いて受け付ける", () => {
    const { email, input } = accepted({ ...valid, email: "  me@example.com ", body: "\n本文 " });
    assert.equal(email, "me@example.com");
    assert.equal(input.body, "本文");
  });
});

describe("parseNoticeInput（長さの上限）", () => {
  const limits: [string, number][] = [
    ["email", 254],
    ["source", 40],
    ["kind", 40],
    ["dedupeKey", 120],
    ["body", NOTICE_BODY_MAX],
  ];

  for (const [field, max] of limits) {
    it(`${field} は ${max} 文字まで受け付け、超えたら項目名と上限を挙げて落とす`, () => {
      accepted(withField(field, "a".repeat(max)));
      const message = rejected(withField(field, "a".repeat(max + 1)));
      assert.ok(message.startsWith(`${field} `), message);
      if (field !== "email") assert.ok(message.includes(String(max)), message);
    });
  }

  it("title は省略できるが、超えたら上限を挙げて落とす", () => {
    assert.equal(accepted(withField("title", undefined)).input.title, undefined);
    assert.equal(accepted(withField("title", null)).input.title, undefined);
    assert.equal(accepted(withField("title", "a".repeat(NOTICE_TITLE_MAX))).input.title, "a".repeat(NOTICE_TITLE_MAX));

    const message = rejected(withField("title", "a".repeat(NOTICE_TITLE_MAX + 1)));
    assert.ok(message.startsWith("title ") && message.includes(String(NOTICE_TITLE_MAX)), message);
  });

  it("空のtitleは省略ではなく不正として落とす", () => {
    assert.match(rejected(withField("title", "")), /^title /);
  });
});

describe("parseNoticeInput（url。#137）", () => {
  it("https の絶対URLとアプリ内のパスを受け付ける", () => {
    assert.equal(accepted(withField("url", "https://example.com/a?b=1")).input.url, "https://example.com/a?b=1");
    assert.equal(accepted(withField("url", "/notices")).input.url, "/notices");
  });

  it("パーセントエンコード済みの改行を含むパスは、正当なパスとして受け付ける", () => {
    assert.equal(accepted(withField("url", "/a%0Ab")).input.url, "/a%0Ab");
  });

  it("null は「リンク無し」として受け付ける", () => {
    assert.equal(accepted(withField("url", null)).input.url, null);
  });

  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example.com/",
    "/\\evil.example.com/",
    "/\n/evil.example.com/",
    "/\t/evil.example.com/",
    "ftp://example.com/",
    "relative/path",
  ]) {
    it(`${JSON.stringify(url)} は保存しない`, () => {
      assert.match(rejected(withField("url", url)), /^url /);
    });
  }

  it("500文字を超えるURLは長さで落とす", () => {
    assert.match(rejected(withField("url", `https://example.com/${"a".repeat(500)}`)), /^url が長すぎます/);
  });

  it("空のURLは「リンク無し」ではなく不正として落とす", () => {
    assert.match(rejected(withField("url", "")), /^url /);
  });
});

describe("parseNoticeInput（priority）", () => {
  it("省略すると NORMAL", () => {
    assert.equal(accepted(valid).input.priority, NoticePriority.NORMAL);
    assert.equal(accepted(withField("priority", null)).input.priority, NoticePriority.NORMAL);
  });

  it("大文字小文字を問わず受け付ける", () => {
    assert.equal(accepted(withField("priority", "urgent")).input.priority, NoticePriority.URGENT);
    assert.equal(accepted(withField("priority", "Low")).input.priority, NoticePriority.LOW);
    assert.equal(accepted(withField("priority", "NORMAL")).input.priority, NoticePriority.NORMAL);
  });

  it("知らない値・文字列でない値は落とす", () => {
    for (const value of ["high", "", 1, {}]) assert.match(rejected(withField("priority", value)), /^priority /);
  });
});

describe("parseNoticeInput（showAt / expiresAt）", () => {
  it("省略は null、日時として読める文字列は Date にする", () => {
    for (const field of ["showAt", "expiresAt"] as const) {
      assert.equal(accepted(valid).input[field], null);
      assert.equal(accepted(withField(field, null)).input[field], null);

      const date = accepted(withField(field, "2026-09-19T09:00:00+09:00")).input[field];
      assert.ok(date instanceof Date);
      assert.equal(date.toISOString(), "2026-09-19T00:00:00.000Z");
    }
  });

  it("日時として読めない値は、その項目名を挙げて落とす", () => {
    for (const field of ["showAt", "expiresAt"]) {
      for (const value of ["あした", "2026-13-99", "", 1, {}]) {
        assert.match(rejected(withField(field, value)), new RegExp(`^${field} `), JSON.stringify(value));
      }
    }
  });
});
