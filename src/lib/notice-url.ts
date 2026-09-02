/**
 * お知らせの遷移先（`Notice.url`）として受け付ける形（#137）。
 *
 * 積む側は他アプリ（AIDE・dayspan など）で、値は**こちらが書いていない文字列**がそのまま
 * DBへ入る。それを `href` や Service Worker の `openWindow()` へ渡すため、判定はここ1か所に
 * 閉じる。**受け取るときと出すときの両方で通す**——列を足す前に積まれた行や、判定を足す前に
 * 通ってしまった行が残っているため、保存時の検証だけでは足りない。
 *
 * **このモジュールはクライアントコンポーネントからimportする**（吹き出し・一覧）。
 * Prismaや `next/headers` に触れるものを持ち込まないこと（`chat-model.ts` と同じ分け方）。
 */

import { isInternalPath } from "@/lib/safe-path";

/** 同じ判定を素のJSでも使う（`public/sw.js`）。直したら向こうも揃える。 */
export function safeNoticeUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("/")) {
    // 判定はログイン後の戻り先（`safe-path.ts`）と1か所で持つ。#137でこちらだけに入れた
    // `/\example.com` の対策が、#140まで `safeInternalPath()` へ入っていなかったため。
    return isInternalPath(trimmed) ? trimmed : null;
  }

  // 絶対URLは http / https だけ。`javascript:` や `data:` を `href` へ入れない。
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // 相対パス（`schedule` のような `/` で始まらない値）もここへ来る。基準になるオリジンが
    // 分からない場所（Service Worker・サーバー）でも同じ判定にしたいので、受け付けない。
    return null;
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  // 正規化した値ではなく元の文字列を返す。`new URL()` は末尾のスラッシュを足すなど見た目を
  // 変えるので、積む側が書いたとおりに保存・表示する。
  return trimmed;
}

/**
 * 別のアプリのページか（＝新しいタブで開くか）。
 *
 * `/` で始まるものだけがこのアプリの中のページ。絶対URLは、たとえ同じオリジンでも外として
 * 扱う——サーバーからもService Workerからも「自分のオリジン」の見え方が揃わないため
 * （本番・localhost・tailnetのホスト名で変わる）。
 */
export function isExternalNoticeUrl(url: string): boolean {
  return !url.startsWith("/");
}
