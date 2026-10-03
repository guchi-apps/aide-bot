#!/usr/bin/env node
// サーバー（TypeScript）とiOSアプリ（Swift）で揃えておく値・判定が食い違っていないかを照合する。
// Xcodeの無い環境（subpc・CI）でも動く。`pnpm test:unit` の `test/ios-consistency.test.ts`
// が同じ関数を使う。単独でも `node ios/scripts/check-consistency.mjs` で実行できる。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf-8");

/** 問題の一覧を返す（空なら整合している）。 */
export function checkConsistency() {
  const problems = [];
  const appConfig = read("ios/Morrow/AppConfig.swift");
  const nativeApp = read("src/lib/native-auth/native-app.ts");
  const webViewModel = read("ios/Morrow/WebViewModel.swift");
  const nativeAuth = read("ios/Morrow/NativeAuth.swift");
  const pbxproj = read("ios/Morrow.xcodeproj/project.pbxproj");

  const swiftScheme = appConfig.match(/authCallbackScheme = "([^"]+)"/)?.[1];
  const tsScheme = nativeApp.match(/NATIVE_SCHEME = "([^"]+)"/)?.[1];
  if (!swiftScheme || swiftScheme !== tsScheme) {
    problems.push(`戻り先スキームが一致しません: Swift=${swiftScheme} / TS=${tsScheme}`);
  }

  // 戻り先のホスト（auth-callback）
  for (const host of ["auth-callback"]) {
    if (!nativeApp.includes(`://${host}`)) problems.push(`native-app.ts に ${host} がありません`);
    if (!webViewModel.includes(`"${host}"`)) problems.push(`WebViewModel.swift に ${host} がありません`);
  }

  // 横取りするパスは、Web側の入口と同じ
  for (const path of ["/auth/signin"]) {
    if (!appConfig.includes(`"${path}"`)) problems.push(`AppConfig.swift が ${path} を横取りしていません`);
  }
  // 引き継ぎの経路
  for (const path of ["auth/native/start", "/auth/native/consume"]) {
    if (!webViewModel.includes(path)) problems.push(`WebViewModel.swift が ${path} を使っていません`);
  }

  // 同一オリジン判定は、スキーム・ホスト・ポートまで見る（Morrow外はWebViewへ読み込まない）
  if (!/url\.scheme == baseURL\.scheme && url\.host == baseURL\.host && url\.port == baseURL\.port/.test(appConfig)) {
    problems.push("AppConfig.isAppURL がスキーム・ホスト・ポートの一致を見ていません");
  }
  if (!/openExternally\(url\)\s*\n\s*return \.cancel/.test(webViewModel)) {
    problems.push("WebViewModel.swift が外部URLをSafariで開いて .cancel していません");
  }

  // 認証シートは毎回エフェメラル（Safariの既存セッションに触れない）
  if (!nativeAuth.includes("prefersEphemeralWebBrowserSession = true")) {
    problems.push("認証シートがエフェメラルではありません");
  }

  // Bundle ID・表示名
  if (!pbxproj.includes("PRODUCT_BUNDLE_IDENTIFIER = com.gucchii.morrow;")) problems.push("Bundle ID が com.gucchii.morrow ではありません");
  if (!pbxproj.includes("INFOPLIST_KEY_CFBundleDisplayName = Morrow;")) problems.push("表示名が Morrow ではありません");

  // 開発用のURLをコミットしていない
  if (!/baseURL = URL\(string: "https:\/\/aide-bot\.gucchii\.com\/"\)!/.test(appConfig)) {
    problems.push("AppConfig.baseURL が本番URLではありません（開発用のまま？）");
  }

  // APNs（#475）: トピック（Bundle ID）・環境・通知の遷移先の判定・entitlements
  const apnsCore = read("src/lib/push/apns-core.ts");
  const topic = apnsCore.match(/APNS_TOPIC = "([^"]+)"/)?.[1];
  if (topic !== "com.gucchii.morrow") problems.push(`APNs の topic が Bundle ID と一致しません: ${topic}`);
  if (!/CODE_SIGN_ENTITLEMENTS = Morrow\.entitlements;/.test(pbxproj)) problems.push("pbxproj が Morrow.entitlements を指していません");
  if (!read("ios/Morrow.entitlements").includes("<key>aps-environment</key>")) problems.push("Morrow.entitlements に aps-environment がありません");
  if (!webViewModel.includes("/api/push/apns")) problems.push("WebViewModel.swift が /api/push/apns を使っていません");
  for (const env of ["production", "sandbox"]) {
    if (!read("ios/Morrow/PushRegistration.swift").includes(`"${env}"`)) problems.push(`PushRegistration.swift に ${env} がありません`);
    if (!apnsCore.includes(`"${env}"`)) problems.push(`apns-core.ts に ${env} がありません`);
  }
  if (!/hasPrefix\("\/\/"\)/.test(appConfig) || !appConfig.includes("0x20")) {
    problems.push("AppConfig.notificationTarget が // と制御文字を弾いていません");
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkConsistency();
  if (problems.length > 0) {
    for (const problem of problems) console.error(`✖ ${problem}`);
    process.exit(1);
  }
  console.log("iOSアプリとサーバーの整合: OK");
}
