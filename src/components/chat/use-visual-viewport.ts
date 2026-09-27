"use client";

import { useEffect } from "react";

/**
 * 画面キーボードが出ている間だけ、画面の高さをキーボードの上に残る範囲へ縮める（#379）。
 *
 * iOSは入力欄へフォーカスすると、`html`/`body` が `overflow-hidden` でもページ（レイアウト
 * ビューポート）を持ち上げて入力欄を見せ、**キーボードを閉じても `window.scrollY` を0へ
 * 戻さないことがある。** そうなると見出しがステータスバーの下へ潜ったまま、入力欄の下に
 * キーボードの高さぶんの空白が残る（#379の報告の形）。`100dvh` はキーボードでは縮まないので、
 * CSSだけでは塞げない。
 *
 * - キーボードが出ている間は `visualViewport.height` を `--app-height` へ書き、`body` と
 *   `ChatShell` の高さに使う。文書がキーボードの上に収まるので、iOSが持ち上げる余地が無くなる
 * - どちらの状態でも、ずれた `window.scrollY` は0へ戻す（閉じた後に残るずれを直すのが本題）
 * - **指で拡大している間（`scale` が1でない）は触らない。** 拡大でも `visualViewport.height` は
 *   縮むので、キーボードと取り違えて画面を縮め、拡大した位置も0へ戻してしまう
 *
 * `viewport` の `interactive-widget=resizes-content` はiOSのSafariが対応しておらず効かない。
 */
export function useVisualViewportFit() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (Math.abs(viewport.scale - 1) > 0.01) return;

      const keyboardOpen = window.innerHeight - viewport.height > KEYBOARD_MIN_HEIGHT;
      if (keyboardOpen) {
        root.style.setProperty("--app-height", `${Math.round(viewport.height)}px`);
        root.dataset.keyboard = "open";
      } else {
        root.style.removeProperty("--app-height");
        delete root.dataset.keyboard;
      }
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    // resize/scrollは1回のキーボードの出入りで何度も届くので、1フレームに1回へ畳む。
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    // キーボードを閉じてもresizeが遅れて届く・届かない端末があるので、フォーカスが外れた回も見る。
    window.addEventListener("focusout", schedule);
    apply();

    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("focusout", schedule);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty("--app-height");
      delete root.dataset.keyboard;
    };
  }, []);
}

/**
 * これより大きく縮んだら画面キーボードとみなす。Safariのツールバーの出入り（数十px）を
 * キーボードと取り違えないため。
 */
const KEYBOARD_MIN_HEIGHT = 120;
