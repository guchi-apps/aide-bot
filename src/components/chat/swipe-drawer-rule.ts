/**
 * スマホのメニュー（ドロワー）をスワイプで開閉するときの判定（#434）。
 * DOMにもReactにも触れない純粋な関数だけを置く（`test/swipe-drawer-rule.test.ts` が境目を固定する）。
 */

/** この距離（px）動くまでは、縦横どちらの操作か決めない。 */
export const AXIS_DECIDE_PX = 10;
/** 横の移動が縦の何倍を超えたら横スワイプとみなすか。縦スクロールの途中で開かないための余裕。 */
export const HORIZONTAL_RATIO = 1.5;
/** 離したときに、この割合以上開いていれば開いたままにする。 */
export const SETTLE_RATIO = 1 / 3;
/** 離す直前の速さ（px/ms）がこれ以上なら、距離が足りなくても指の向きに従う。 */
export const FLING_VELOCITY = 0.4;
/** この幅（px）以上ではメニューが常設なのでスワイプを働かせない（Tailwindの `md`）。 */
export const DESKTOP_MIN_WIDTH = 768;

export type Axis = "pending" | "horizontal" | "vertical";

/** 動き始めの移動量から、横スワイプか縦スクロールかを決める。 */
export function decideAxis(dx: number, dy: number): Axis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < AXIS_DECIDE_PX && ay < AXIS_DECIDE_PX) return "pending";
  return ax > ay * HORIZONTAL_RATIO ? "horizontal" : "vertical";
}

/** 開いている割合（0〜1）。`open` はスワイプを始めたときの状態。 */
export function progressFor(open: boolean, dx: number, width: number): number {
  if (width <= 0) return open ? 1 : 0;
  const base = open ? width : 0;
  return Math.min(1, Math.max(0, (base + dx) / width));
}

/** 指を離したとき、開いた状態にするか。 */
export function shouldSettleOpen(progress: number, velocity: number): boolean {
  if (Math.abs(velocity) >= FLING_VELOCITY) return velocity > 0;
  return progress >= SETTLE_RATIO;
}

/**
 * 閉じているときは右へ、開いているときは左へ動かし始めたものだけを対象にする。
 * 逆向きの動きは、他の横スワイプ（表の横スクロールなど）に任せる。
 */
export function matchesOpenDirection(open: boolean, dx: number): boolean {
  return open ? dx < 0 : dx > 0;
}

export type TouchTargetInfo = {
  tagName: string;
  isContentEditable?: boolean;
  /** `data-swipe-drawer-ignore` が付いている（他の横スワイプを持つ領域）。 */
  ignoreMarked?: boolean;
  /** `overflow-x` が効いていて、実際に横へ動かせる。 */
  scrollsHorizontally?: boolean;
};

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * このタッチはドロワーのスワイプを始めてはいけない対象か。
 * 文字入力・スライダー（`input[type=range]`）・横スクロールできる要素・他の横スワイプの領域。
 */
export function blocksDrawerSwipe(info: TouchTargetInfo): boolean {
  if (EDITABLE_TAGS.has(info.tagName.toUpperCase())) return true;
  return Boolean(info.isContentEditable || info.ignoreMarked || info.scrollsHorizontally);
}
