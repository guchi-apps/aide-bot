"use client";

import { useEffect, useRef, useState } from "react";

import {
  DESKTOP_MIN_WIDTH,
  blocksDrawerSwipe,
  decideAxis,
  matchesOpenDirection,
  progressFor,
  shouldSettleOpen,
  type TouchTargetInfo,
} from "./swipe-drawer-rule";

type Options = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ドロワーの幅を返す。指の移動量を開き具合へ直すのに使う。 */
  getWidth: () => number;
};

type Gesture = {
  startX: number;
  startY: number;
  startOpen: boolean;
  axis: "pending" | "horizontal" | "vertical";
  lastX: number;
  lastT: number;
  velocity: number;
  progress: number;
};

function describeTarget(start: EventTarget | null): TouchTargetInfo {
  const info: TouchTargetInfo = { tagName: "", scrollsHorizontally: false };
  let node = start instanceof Element ? start : null;
  while (node) {
    if (!info.tagName) info.tagName = node.tagName;
    if (node instanceof HTMLElement && node.isContentEditable) info.isContentEditable = true;
    if (node.hasAttribute("data-swipe-drawer-ignore")) info.ignoreMarked = true;
    if (node.scrollWidth > node.clientWidth) {
      const overflowX = getComputedStyle(node).overflowX;
      if (overflowX === "auto" || overflowX === "scroll") info.scrollsHorizontally = true;
    }
    node = node.parentElement;
  }
  return info;
}

/**
 * スマホでドロワーを右スワイプで開き、左スワイプで閉じる（#434）。
 * 戻り値は指に追従している間の開き具合（0〜1）。触っていないときは `null`。
 *
 * `touchmove` で `preventDefault()` しない（passive）。縦の操作はそのままページに任せ、
 * 横と決まった動きだけを拾う。`html`/`body` が縦に動かない（#191）ので、横の動きの最中に
 * ページが一緒に動くことはない。
 */
export function useSwipeDrawer({ open, onOpenChange, getWidth }: Options): number | null {
  const [dragProgress, setDragProgress] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  // リスナーは1度だけ付けたいので、最新の値は ref 経由で読む。
  const latest = useRef({ open, onOpenChange, getWidth });
  useEffect(() => {
    latest.current = { open, onOpenChange, getWidth };
  });

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      gesture.current = null;
      if (event.touches.length !== 1) return;
      if (window.innerWidth >= DESKTOP_MIN_WIDTH) return;
      if (blocksDrawerSwipe(describeTarget(event.target))) return;
      const touch = event.touches[0];
      gesture.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startOpen: latest.current.open,
        axis: "pending",
        lastX: touch.clientX,
        lastT: event.timeStamp,
        velocity: 0,
        progress: latest.current.open ? 1 : 0,
      };
    };

    const onMove = (event: TouchEvent) => {
      const g = gesture.current;
      if (!g || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - g.startX;
      const dy = touch.clientY - g.startY;
      if (g.axis === "pending") {
        g.axis = decideAxis(dx, dy);
        if (g.axis === "horizontal" && !matchesOpenDirection(g.startOpen, dx)) g.axis = "vertical";
      }
      if (g.axis !== "horizontal") return;
      const dt = event.timeStamp - g.lastT;
      if (dt > 0) g.velocity = (touch.clientX - g.lastX) / dt;
      g.lastX = touch.clientX;
      g.lastT = event.timeStamp;
      g.progress = progressFor(g.startOpen, dx, latest.current.getWidth());
      setDragProgress(g.progress);
    };

    const onEnd = () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.axis !== "horizontal") return;
      setDragProgress(null);
      const next = shouldSettleOpen(g.progress, g.velocity, g.startOpen);
      if (next !== latest.current.open) latest.current.onOpenChange(next);
    };

    const onCancel = () => {
      const g = gesture.current;
      gesture.current = null;
      if (g?.axis === "horizontal") setDragProgress(null);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
    };
  }, []);

  return dragProgress;
}
