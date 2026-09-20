/**
 * 秘書から話しかけるときの歯止めと、文面の組み立て（#278）。
 *
 * 歯止めがずれると「頼んでいない発言」が短い間隔で積まれ、朝の見通し（#79）が避けた
 * 「読まれなくなる通知」と同じ末路になる。リンクの組み立ては**外から来た文字列**
 * （モデルが書いた記事の題・他のアプリが積んだタイトル）を本文へ埋めるので、
 * 壊れた形を作らないことをここで固定する。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NUDGE_INTERVAL_MS,
  NUDGE_QUIET_MS,
  quietEnough,
  topicNudgeDue,
  withSourceLink,
} from "@/lib/nudge-choice";

const NOW = Date.parse("2026-09-20T12:00:00+09:00");

describe("topicNudgeDue", () => {
  it("まだ一度も話しかけていなければ話しかけてよい", () => {
    assert.equal(topicNudgeDue(NOW, null), true);
  });

  it("前回から間隔があいていなければ見送る", () => {
    assert.equal(topicNudgeDue(NOW, NOW), false);
    assert.equal(topicNudgeDue(NOW, NOW - NUDGE_INTERVAL_MS + 1), false);
  });

  it("間隔ぴったりからは話しかけてよい", () => {
    assert.equal(topicNudgeDue(NOW, NOW - NUDGE_INTERVAL_MS), true);
    assert.equal(topicNudgeDue(NOW, NOW - NUDGE_INTERVAL_MS * 3), true);
  });
});

describe("quietEnough", () => {
  it("発言が1件も無ければ話しかけてよい", () => {
    assert.equal(quietEnough(NOW, null), true);
  });

  it("話している最中（生成中を含む）は見送る", () => {
    assert.equal(quietEnough(NOW, NOW), false);
    assert.equal(quietEnough(NOW, NOW - NUDGE_QUIET_MS + 1), false);
  });

  it("会話が途切れていれば話しかけてよい", () => {
    assert.equal(quietEnough(NOW, NOW - NUDGE_QUIET_MS), true);
  });
});

describe("withSourceLink", () => {
  it("リンクが無ければ本文だけを返す", () => {
    assert.equal(withSourceLink("こんな話がありました", "見出し", null), "こんな話がありました");
    assert.equal(withSourceLink("こんな話がありました", "見出し", ""), "こんな話がありました");
    assert.equal(withSourceLink("こんな話がありました", "見出し", undefined), "こんな話がありました");
  });

  it("本文の後ろへMarkdownのリンクを足す", () => {
    assert.equal(
      withSourceLink("こんな話が", "見出し（NHK）", "https://example.com/news/1"),
      "こんな話が\n\n[見出し（NHK）](<https://example.com/news/1>)",
    );
  });

  it("閉じ括弧を含むURLでもリンクが切れない", () => {
    // 山括弧で囲んでいるので、`)` はURLの一部として読まれる。
    assert.equal(
      withSourceLink("本文", "題", "https://example.com/a(2026)"),
      "本文\n\n[題](<https://example.com/a(2026)>)",
    );
  });

  it("見出しの角括弧は打ち消し、改行は1行へ畳む", () => {
    assert.equal(
      withSourceLink("本文", "【速報】[独自]\n続報あり", "https://example.com/a"),
      "本文\n\n[【速報】\\[独自\\] 続報あり](<https://example.com/a>)",
    );
  });

  it("見出しが空なら既定の文言を出す", () => {
    assert.equal(withSourceLink("本文", "   ", "https://example.com/a"), "本文\n\n[元のページを開く](<https://example.com/a>)");
  });

  it("山括弧を含むURLはリンクにしない（囲めないため）", () => {
    assert.equal(withSourceLink("本文", "題", "https://example.com/a<b>"), "本文");
  });
});
