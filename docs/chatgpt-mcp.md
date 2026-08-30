# ChatGPTのスケジュールからAIDEへ登録する

**いつ読むか**: ChatGPTのスケジュールタスクからAIDEへ通知・タスク・日次ブリーフを登録するときに読む。

## ChatGPTのスケジュールはAIDEのMCPを呼ぶ

このアプリはChatGPTのサブスクリプションをサーバー側で直接消費しない。ChatGPTのスケジュールタスクが
接続済みアプリから情報を集め、AIDEのMCPエンドポイントへ登録する。エンドポイントは
`POST /api/mcp` で、`NOTICE_INGEST_TOKEN` のBearer認証を使う。

利用できるツールは `aide_create_notification`、`aide_create_task_candidate`、`aide_save_daily_brief` の3つ。
いずれも同じお知らせの受け皿へ保存し、`email`、`source`、`dedupeKey`、`title`、`summary`、元リンク、
優先度、推奨アクション、取得日時を持つ。`dedupeKey` が同じ登録は上書きされるため、スケジュール側は
同じ用件に毎回同じキーを使う。

## スケジュール側の指示

「接続済みアプリから、返信や確認が必要なメール、今後の予定、対応が必要なタスクを調べる。知らせる価値が
あるものだけを選び、AIDEの `aide_create_notification` または `aide_create_task_candidate` を呼ぶ。元URL、
情報源、安定した重複判定キー、優先度、推奨アクションを必ず渡す。該当が無ければ何も登録しない。」

接続設定、公開HTTPS URL、認証情報の登録はリポジトリ外の作業である。認証トークンの実値はこの文書や
Issue、ログへ記録しない。ChatGPTのスケジュールが外部MCPを承認なしで呼べるかは、テスト用の通知を
登録して確認する。
