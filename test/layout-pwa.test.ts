import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const layoutSource = readFileSync(path.join(process.cwd(), "src/app/layout.tsx"), "utf8");
const chatShellSource = readFileSync(path.join(process.cwd(), "src/components/chat/chat-shell.tsx"), "utf8");

test("iOS PWAでは透過ステータスバーを使う", () => {
  assert.match(layoutSource, /statusBarStyle: "black-translucent"/);
  assert.match(layoutSource, /viewportFit: "cover"/);
});

test("ヘッダーは上端の安全領域をヘッダー色で覆う", () => {
  assert.match(chatShellSource, /bg-surface/);
  assert.match(chatShellSource, /pt-\[calc\(env\(safe-area-inset-top\)\+0\.625rem\)\]/);
});
