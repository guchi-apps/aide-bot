"use client";

import { memo, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * 秘書のいまの状態。画面の文言と立ち絵はこの1つの値から決める。
 *
 * `preparing` はVOICEVOXの声で合成の出来上がりを待っている間（#52）。返答はもう出ているので
 * `thinking` ではなく、まだ鳴っていないので `speaking` でもない。ここを `thinking` のままに
 * すると、7秒前後の無音が「返事が来ないだけ」に見えて、利用者はマイクを押して割り込む。
 */
export type SecretaryState = "idle" | "listening" | "thinking" | "preparing" | "speaking";

/** 立ち絵の5枚（#326）。素材は `public/secretary/`。 */
type Pose = "idle" | "listening" | "thinking" | "speaking" | "notifying";

const POSES: readonly Pose[] = ["idle", "listening", "thinking", "speaking", "notifying"];

/**
 * 状態から見せる1枚を決める。**知らせる（`notifying`）は会話の状態ではない**——待っている間に
 * 吹き出しへお知らせを出しているときだけの姿なので、呼ぶ側から `notifying` で受け取る。
 * VOICEVOXの準備中（`preparing`）は、まだ声が出ていないので「考える」のまま見せる。
 */
function poseFor(state: SecretaryState, notifying: boolean): Pose {
  switch (state) {
    case "listening":
      return "listening";
    case "thinking":
    case "preparing":
      return "thinking";
    case "speaking":
      return "speaking";
    case "idle":
      return notifying ? "notifying" : "idle";
  }
}

type Props = {
  state: SecretaryState;
  /** 待っている間、吹き出しにお知らせ（#93）を出しているか。 */
  notifying?: boolean;
  /** 声が届いた直後だけ true。聞き取り中に少し前へ寄る。 */
  reacting?: boolean;
  className?: string;
};

/**
 * 画面の中央にいる秘書の立ち絵（#326。#49のロボットを置き換えた）。
 *
 * 待っているのか、聞いているのか、考えているのか、話しているのかを、文字を読まなくても
 * 分かるようにするためのもの。**絵は飾りで、押せる部品にはしない**——ロボットにあった
 * 回転（#201）・視線追従（#180）・部位タップ（#180・#215）は、平面の絵では成り立たないので
 * やめた。状態は吹き出しの文言でも伝えているので、絵は `aria-hidden` のままにしてある。
 *
 * **5枚を重ねて置き、いまの1枚だけを見せる。** 状態が変わるたびに `src` を差し替えると、
 * 読み込みが間に合わない回に一瞬だけ空白が出る。動き（揺れ・フェード）は `globals.css` の
 * `.sec-*` にある。
 *
 * **画像を読み込めなかったら、立ち絵の場所に小さな印だけを出す。** 会話と操作は絵に
 * 依存していないので、そのまま続けられる。
 */
function SecretaryView({ state, notifying = false, reacting = false, className }: Props) {
  const pose = poseFor(state, notifying);
  const [failed, setFailed] = useState<ReadonlySet<Pose>>(() => new Set());
  const imgs = useRef<Partial<Record<Pose, HTMLImageElement | null>>>({});

  /*
   * ハイドレーションより前に読み込みに失敗した画像は、Reactの `onError` へ届かない
   * （イベントはハンドラを付ける前に発火し終わっている）。付け終えた時点で一度だけ見直す。
   */
  useEffect(() => {
    const broken = POSES.filter((p) => {
      const img = imgs.current[p];
      return img?.complete && img.naturalWidth === 0;
    });
    if (broken.length > 0) setFailed(new Set(broken));
  }, []);

  if (failed.has(pose)) {
    return (
      <div className={cn("grid shrink-0 place-items-center", className)} aria-hidden="true">
        <span className="grid size-28 place-items-center rounded-full bg-accent-surface text-base font-bold text-accent">
          秘書
        </span>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative shrink-0 aspect-[780/860]",
        `sec-${pose}`,
        reacting && state === "listening" && "sec-reacting",
        className,
      )}
    >
      <div className="sec-stage absolute inset-x-[-12%] bottom-0 top-[6%]" />
      <div className="sec-figure absolute inset-0">
        {POSES.map((p) => (
          // 素材は切り抜き・縮小済みのWebP（1枚約40KB）なので、next/image の変換は通さない。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p}
            ref={(el) => {
              imgs.current[p] = el;
            }}
            src={`/secretary/${p}.webp`}
            alt=""
            width={780}
            height={860}
            draggable={false}
            decoding="async"
            data-active={p === pose ? "" : undefined}
            onError={() => setFailed((prev) => new Set(prev).add(p))}
            className="sec-pose absolute inset-0 size-full select-none"
          />
        ))}
      </div>
    </div>
  );
}

/**
 * `memo` で包んで、props が変わったときだけ描く（#228）。
 *
 * 「話す」画面は聞き取りの途中経過（interim）や返答の差分のたびに描き直されるが、そのたびに
 * 立ち絵まで巻き込む理由は無い。props はどれも文字列か真偽値なので、そのまま比べてよい。
 */
export const Secretary = memo(SecretaryView);
