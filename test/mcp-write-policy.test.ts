import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_PRESETS } from "../src/lib/mcp/presets.ts";

const aide = MCP_PRESETS.find((p) => p.id === "aide")!;

test("読み取りの許可リストと書き込みの一覧は重ならない", () => {
  const writes = new Set(aide.writeTools);
  for (const tool of aide.readTools ?? []) {
    assert.equal(writes.has(tool), false, tool);
  }
});

test("#366で漏れていた状態変更の道具が書き込みに入っている", () => {
  for (const tool of [
    "aide_room_press",
    "aide_aircon_control",
    "issue_deck_upload_image",
    "asset_manager_create_subscription",
    "asset_manager_add_subscription_price",
    "aide_research_desk_import_weekly_report",
  ]) {
    assert.ok(aide.writeTools.includes(tool), tool);
  }
});

test("未分類の新しい道具は許可リストに入らない", () => {
  assert.equal((aide.readTools ?? []).includes("aide_new_mutating_tool"), false);
});
