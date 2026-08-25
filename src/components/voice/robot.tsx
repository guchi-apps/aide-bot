"use client";

import { useId } from "react";

import { cn } from "@/lib/utils";

/** 秘書のいまの状態。画面の文言とロボットの見た目はこの1つの値から決める。 */
export type RobotState = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  state: RobotState;
  /** 声が届いた直後だけ true。聞き取り中にひと回り大きくする。 */
  reacting?: boolean;
  className?: string;
};

/**
 * 画面の中央にいる「秘書」のロボット（#49）。絵は `public/icon.svg` と同じ一体。
 *
 * 待っているのか、聞いているのか、考えているのか、話しているのかを、文字を読まなくても
 * 分かるようにするためのもの。動きはすべて `globals.css` の `.bot` 側に置く——
 * 状態ごとのキーフレームをTailwindのユーティリティでは書けないため。
 *
 * グラデーションのidに `useId()` を混ぜているのは、同じ絵が1ページに2つ出ても定義が
 * ぶつからないようにするため。React が返す値には記号が混じるので、そのまま
 * `url(#...)` に入れず英数字だけへ落としてある。
 */
export function Robot({ state, reacting = false, className }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={cn("bot", `bot-${state}`, reacting && "bot-reacting", className)}
    >
      <defs>
        <radialGradient id={`${uid}-body`} cx="36%" cy="26%" r="82%">
          <stop offset="0" stopColor="#f8e0be" />
          <stop offset="0.52" stopColor="#e6bd90" />
          <stop offset="1" stopColor="#c1925f" />
        </radialGradient>
        <linearGradient id={`${uid}-face`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3e2f26" />
          <stop offset="1" stopColor="#211812" />
        </linearGradient>
        <linearGradient id={`${uid}-shell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c5540" />
          <stop offset="1" stopColor="#4f3226" />
        </linearGradient>
        <linearGradient id={`${uid}-eye`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fdcff" />
          <stop offset="1" stopColor="#2b8ff5" />
        </linearGradient>
        <radialGradient id={`${uid}-lamp`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#9fe2ff" />
          <stop offset="1" stopColor="#2b8ff5" />
        </radialGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#7fd0ff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7fd0ff" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-knit`} width="20" height="16" patternUnits="userSpaceOnUse">
          <path
            d="M0 13 L5 3 L10 13 M10 13 L15 3 L20 13"
            fill="none"
            stroke="#8d5f36"
            strokeOpacity="0.22"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </pattern>
      </defs>

      <ellipse cx="256" cy="452" rx="118" ry="15" fill="#000000" opacity="0.16" />

      {/* 体まわりは1つのグループで動かす。呼吸・前のめり・首かしげ・うなずきはここに効く。 */}
      <g className="bot-body">
        <ellipse cx="148" cy="410" rx="30" ry="24" fill={`url(#${uid}-shell)`} />
        <ellipse cx="364" cy="410" rx="30" ry="24" fill={`url(#${uid}-shell)`} />
        <ellipse cx="110" cy="296" rx="25" ry="39" fill={`url(#${uid}-shell)`} />
        <ellipse cx="402" cy="296" rx="25" ry="39" fill={`url(#${uid}-shell)`} />

        <g className="bot-lamp">
          <circle cx="256" cy="130" r="30" fill={`url(#${uid}-glow)`} />
          <circle cx="256" cy="130" r="11" fill={`url(#${uid}-lamp)`} />
        </g>
        <rect x="252" y="132" width="8" height="42" rx="4" fill="#3a291f" />
        <ellipse cx="256" cy="176" rx="47" ry="13" fill={`url(#${uid}-shell)`} />

        <ellipse cx="256" cy="300" rx="152" ry="143" fill={`url(#${uid}-body)`} />
        <ellipse cx="256" cy="300" rx="152" ry="143" fill={`url(#${uid}-knit)`} />
        <path
          d="M132 258 Q256 208 380 258"
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.3"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <ellipse
          cx="256"
          cy="300"
          rx="152"
          ry="143"
          fill="none"
          stroke="#a97c4d"
          strokeOpacity="0.35"
          strokeWidth="3"
        />

        <ellipse cx="206" cy="432" rx="31" ry="22" fill={`url(#${uid}-shell)`} />
        <ellipse cx="306" cy="432" rx="31" ry="22" fill={`url(#${uid}-shell)`} />

        <rect x="148" y="230" width="216" height="152" rx="72" fill={`url(#${uid}-face)`} />
        <rect x="158" y="240" width="196" height="60" rx="30" fill="#ffffff" opacity="0.05" />

        <g className="bot-eye bot-eye-l">
          <circle
            cx="206"
            cy="302"
            r="31"
            fill="none"
            stroke="#7fd0ff"
            strokeOpacity="0.35"
            strokeWidth="3"
          />
          <circle cx="206" cy="302" r="22" fill="none" stroke={`url(#${uid}-eye)`} strokeWidth="9" />
          <circle cx="206" cy="302" r="14" fill="#101d29" />
          <circle cx="198" cy="293" r="5.5" fill="#eaf7ff" />
        </g>
        <g className="bot-eye bot-eye-r">
          <circle
            cx="306"
            cy="302"
            r="31"
            fill="none"
            stroke="#7fd0ff"
            strokeOpacity="0.35"
            strokeWidth="3"
          />
          <circle cx="306" cy="302" r="22" fill="none" stroke={`url(#${uid}-eye)`} strokeWidth="9" />
          <circle cx="306" cy="302" r="14" fill="#101d29" />
          <circle cx="298" cy="293" r="5.5" fill="#eaf7ff" />
        </g>

        <ellipse className="bot-mouth" cx="256" cy="354" rx="14" ry="10" fill="#140e0a" />
      </g>

      {/* アンテナから広がる波。聞いているときと話しているときだけ出る。 */}
      <g fill="none" stroke="#5cc0ff" strokeWidth="6" strokeLinecap="round">
        <path className="bot-wave" d="M224.1 141.6 A 34 34 0 0 1 244.4 98.1" />
        <path className="bot-wave bot-wave-2" d="M287.9 141.6 A 34 34 0 0 0 267.6 98.1" />
        <path
          className="bot-wave bot-wave-3"
          d="M207.1 147.8 A 52 52 0 0 1 238.2 81.1"
          strokeWidth="5"
        />
        <path
          className="bot-wave bot-wave-4"
          d="M304.9 147.8 A 52 52 0 0 0 273.8 81.1"
          strokeWidth="5"
        />
      </g>

      {/* 考えている間だけ、頭の上で順に跳ねる3点。 */}
      <g className="bot-think" fill="#5cc0ff">
        <circle className="bot-dot" cx="212" cy="104" r="8" />
        <circle className="bot-dot bot-dot-2" cx="256" cy="92" r="8" />
        <circle className="bot-dot bot-dot-3" cx="300" cy="104" r="8" />
      </g>
    </svg>
  );
}
