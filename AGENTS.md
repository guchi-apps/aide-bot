# aide-bot Codex instructions

作業を始める前に、リポジトリ直下の `CLAUDE.md` を全文読むこと。
同ファイルに記載されたプロジェクト固有ルール、参照順、禁止事項、検証手順を
Codex にも適用する。

表記上の「Claude」「Claude Code」「実装エージェント」は、Codex で作業している場合は
「Codex」と読み替える。ただし、Claude 専用の GitHub Actions、`@claude` トリガー、
コマンド、設定など、特定製品を明示した仕組みは読み替えない。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
