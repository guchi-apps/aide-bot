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

test("朝の見通しの道具は読み取りの許可リストに収まり、書き込みを含まない（#367）", async () => {
  const { briefingToolsFor } = await import("../src/lib/mcp/presets.ts");
  const tools = briefingToolsFor(aide.url) ?? [];
  assert.equal(tools.length, 10);
  for (const tool of tools) {
    assert.ok((aide.readTools ?? []).includes(tool), tool);
    assert.equal(aide.writeTools.includes(tool), false, tool);
  }
  // 材料の道具は BRIEFING_MATERIAL_RULES に名前が出ているものだけ。
  const { BRIEFING_MATERIAL_RULES } = await import("../src/lib/anthropic.ts");
  for (const tool of tools) assert.ok(BRIEFING_MATERIAL_RULES.join("\n").includes(tool), tool);
  assert.equal(briefingToolsFor("https://mcp.notion.com/mcp"), undefined);
});
