/** 端末の覚え書き。DBに触れないので `apns.ts` と `subscriptions.ts` の両方から読める（循環importを避ける）。 */

/**
 * User-Agentから端末の覚え書きを作る。
 *
 * 設定の画面に「登録済みの端末」を件数で出すため、どれがどれか分かる程度で足りる。
 * 厳密に判定しようとすると当たらない端末が必ず出るので、素直に代表的な語を拾うだけにする。
 */
export function deviceLabelFromUserAgent(userAgent: string | null): string {
  const ua = userAgent ?? "";

  // iOSアプリ（殻。#475）はUAの末尾に `MorrowIOS/<版>` を足している
  if (/MorrowIOS\//.test(ua)) return /iPad/.test(ua) ? "Morrowアプリ / iPad" : "Morrowアプリ / iPhone";

  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "不明な端末";

  // 判定の順は大事。ChromeもEdgeも Safari を名乗り、EdgeはChromeも名乗る。
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";

  return (browser === "" ? os : `${os} / ${browser}`).slice(0, 120);
}
