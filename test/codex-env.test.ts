/**
 * Codexの子プロセスへ渡す環境変数（#258）。
 *
 * 許可リストから漏れるとCodexが認証情報を見つけられず相談ごと動かなくなり、逆に許可しすぎると
 * アプリのシークレット（本番の `.env` にある `DATABASE_URL` など）がモデルから見える。
 * どちらも画面からは気付きにくいので、名前の表で固定しておく。
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { codexChildEnv } from "@/lib/codex";

describe("codexChildEnv", () => {
  it("アプリのシークレット・設定値は渡さない", () => {
    const env = codexChildEnv({
      PATH: "/usr/bin",
      DATABASE_URL: "mysql://user:pw@127.0.0.1/app_aide_bot",
      VAPID_PRIVATE_KEY: "vapid",
      BRIEFING_TRIGGER_TOKEN: "briefing",
      NOTICE_INGEST_TOKEN: "notice",
      CI_LOGIN_BYPASS_SECRET: "bypass",
      ALLOWED_GOOGLE_EMAILS: "a@example.com",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SECRET_KEY: "supabase",
      NODE_ENV: "production",
      PORT: "3103",
    });

    assert.deepEqual(env, { PATH: "/usr/bin" });
  });

  it("Codexが動くのに要るもの（実行ファイル・認証情報の場所・ロケール）は渡す", () => {
    const base = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/home/user",
      USER: "user",
      LOGNAME: "user",
      SHELL: "/bin/bash",
      LANG: "ja_JP.UTF-8",
      LC_ALL: "C.UTF-8",
      LC_CTYPE: "C.UTF-8",
      TZ: "Asia/Tokyo",
      TMPDIR: "/tmp",
      TERM: "dumb",
      CODEX_HOME: "/home/user/.codex",
      CODEX_CA_CERTIFICATE: "/etc/ssl/ca.pem",
      XDG_CONFIG_HOME: "/home/user/.config",
      XDG_RUNTIME_DIR: "/run/user/1000",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      SSL_CERT_DIR: "/etc/ssl/certs",
      NODE_EXTRA_CA_CERTS: "/etc/ssl/extra.pem",
    };

    assert.deepEqual(codexChildEnv(base), base);
  });

  it("プロキシの設定は大文字・小文字のどちらも渡す", () => {
    const base = {
      HTTP_PROXY: "http://proxy:8080",
      https_proxy: "http://proxy:8080",
      ALL_PROXY: "socks5://proxy:1080",
      no_proxy: "localhost",
    };

    assert.deepEqual(codexChildEnv(base), base);
  });

  it("名前が似ているだけのものは渡さない（前方一致・大文字小文字の取り違え）", () => {
    const env = codexChildEnv({
      // `HOME` ではない。
      HOMEPAGE_TOKEN: "x",
      // `LC_` は大文字だけ。小文字の `lc_` は別物。
      lc_secret: "x",
      // `PATH` の完全一致だけ。
      PATHS: "x",
      MY_CODEX_TOKEN: "x",
      // `TZ` の完全一致だけ。
      TZ_SECRET: "x",
    });

    assert.deepEqual(env, {});
  });

  it("値の無い変数は落とす", () => {
    assert.deepEqual(codexChildEnv({ PATH: undefined, HOME: "/home/user" }), { HOME: "/home/user" });
  });

  it("MCPのアクセストークン（extra）は許可リストを通さず、そのまま足す", () => {
    const env = codexChildEnv(
      { PATH: "/usr/bin", DATABASE_URL: "mysql://secret" },
      { AIDE_BOT_MCP_TOKEN_AIDE: "token" },
    );

    assert.deepEqual(env, { PATH: "/usr/bin", AIDE_BOT_MCP_TOKEN_AIDE: "token" });
  });

  it("元の環境を書き換えない", () => {
    const base = { PATH: "/usr/bin", DATABASE_URL: "mysql://secret" };
    codexChildEnv(base, { AIDE_BOT_MCP_TOKEN_AIDE: "token" });

    assert.deepEqual(base, { PATH: "/usr/bin", DATABASE_URL: "mysql://secret" });
  });
});
