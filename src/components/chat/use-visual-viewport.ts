"use client";

import { useEffect } from "react";

/** キーボードで表示領域が変わったことを、会話欄へ伝えるイベント名。 */
export const KEYBOARD_VIEWPORT_CHANGE_EVENT = "morrow:keyboard-viewport-change";

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
      if (!shouldApplyVisualViewport(viewport.scale)) return;

      const keyboardOpen = isKeyboardOpen(
        window.innerHeight,
        viewport.height,
        isEditableFocused(document.activeElement),
      );
      if (keyboardOpen) {
        const height = `${Math.round(viewport.height)}px`;
        const changed = root.style.getPropertyValue("--app-height") !== height;
        root.style.setProperty("--app-height", height);
        root.dataset.keyboard = "open";
        // 高さだけを変えても会話欄のスクロール位置はそのまま残る。キーボードによる変化の回だけ
        // 末尾へ寄せ、最新の対話が押し出されないようにする（#385）。
        if (changed) window.dispatchEvent(new Event(KEYBOARD_VIEWPORT_CHANGE_EVENT));
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
    // 入力欄へフォーカスした直後はresizeが遅れる・1度も届かない端末（#476）があるので、
    // キーボードが出きるまでのあいだ数回見直す。
    const timers: number[] = [];
    const onFocusIn = () => {
      schedule();
      for (const delay of FOCUS_RECHECK_MS) timers.push(window.setTimeout(schedule, delay));
    };
    window.addEventListener("focusin", onFocusIn);
    apply();

    return () => {
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("focusout", schedule);
      window.removeEventListener("focusin", onFocusIn);
      for (const timer of timers) window.clearTimeout(timer);
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

/** 入力欄にフォーカスしている間は、ツールバーとの取り違えが起きにくいので、より小さい縮みも拾う（#476）。 */
const KEYBOARD_MIN_HEIGHT_FOCUSED = 60;

/** フォーカス直後にキーボードの出きるのを待つ見直しの間隔（ミリ秒）。 */
const FOCUS_RECHECK_MS = [150, 400, 800];

/** Safariのツールバー程度の縮みは、キーボードとして扱わない。 */
export function isKeyboardOpen(
  layoutHeight: number,
  visualHeight: number,
  editableFocused = false,
) {
  const min = editableFocused ? KEYBOARD_MIN_HEIGHT_FOCUSED : KEYBOARD_MIN_HEIGHT;
  return layoutHeight - visualHeight > min;
}

/** 文字を入力する要素にフォーカスしているか（画面キーボードが出る要素）。 */
export function isEditableFocused(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "range", "file", "color"].includes(
      element.type,
    );
  }
  return element instanceof HTMLElement && element.isContentEditable;
}

/** 指で拡大している間は、キーボード表示と取り違えない。 */
export function shouldApplyVisualViewport(scale: number) {
  return Math.abs(scale - 1) <= 0.01;
}
