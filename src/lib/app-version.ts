import packageJson from "../../package.json";

/**
 * 画面に出すアプリのバージョン。正は `package.json` の `version` で、
 * リリース時のbumpにそのまま追従する。
 *
 * **クライアントコンポーネントから直接importしないこと。** JSONのimportは
 * プロパティ単位では削られず、`package.json` が丸ごとクライアントバンドルへ入る
 * （依存パッケージ名や `packageManager` のハッシュまで配られる）。
 * サーバーコンポーネントで読み、propsで渡す。
 */
export const APP_VERSION = packageJson.version;
