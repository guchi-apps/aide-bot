"use client";

import { forwardRef, useCallback, useEffect, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { RobotPart } from "./robot-3d/scene";
import { pickBodyReaction, type BodyReactionKind } from "./robot-reaction";

/** SVGフォールバックが受け付ける反応の種類。体の3種類（#215）とアンテナの発光。 */
type FallbackReaction = "antenna" | BodyReactionKind;

/**
 * 秘書のいまの状態。画面の文言とロボットの見た目はこの1つの値から決める。
 *
 * `preparing` はVOICEVOXの声で合成の出来上がりを待っている間（#52）。返答はもう出ているので
 * `thinking` ではなく、まだ鳴っていないので `speaking` でもない。ここを `thinking` のままに
 * すると、7秒前後の無音が「返事が来ないだけ」に見えて、利用者はマイクを押して割り込む。
 */
export type RobotState = "idle" | "listening" | "thinking" | "preparing" | "speaking";

type Props = {
  state: RobotState;
  /** 声が届いた直後だけ true。聞き取り中にひと回り大きくする。 */
  reacting?: boolean;
  className?: string;
};

/** 触られた反応が続く長さ（ミリ秒）。3D側（`robot-3d/scene.ts`）と揃えてある。 */
const REACTION_MS = 700;
/** 反応が終わってから次を受け付けるまで（ミリ秒）。 */
const REACTION_COOLDOWN_MS = 400;
/** これ以上指が動いたら、押したのではなく画面を送ったものとして扱う（ピクセル）。 */
const TAP_SLOP_PX = 12;
/** これより長く押されていたら、押したのではなく長押しとして扱う（ミリ秒）。 */
const TAP_HOLD_MS = 700;
/** 横に1px動かすごとに回す角度（ラジアン。#201）。指の動きにそのまま追従させる。 */
const SPIN_SENSITIVITY = 0.012;
/** 慣性の減衰（1/60秒ごとの倍率）。1に近いほど長く回り続ける。 */
const SPIN_FRICTION = 0.95;
/** これより角速度が小さくなったら、惰性回転を止める（ラジアン/フレーム）。 */
const SPIN_MIN_VELOCITY = 0.0008;
/** 慣性の1歩を60fps換算するための基準（ミリ秒）。 */
const SPIN_FRAME_MS = 1000 / 60;

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
const RobotFallback = forwardRef<SVGSVGElement, Props & { reaction?: FallbackReaction | null }>(function RobotFallback(
  { state, reacting = false, reaction, className },
  ref,
) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <svg
      ref={ref}
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={cn(
        "bot",
        `bot-${state}`,
        reacting && "bot-reacting",
        reaction === "bow" && "bot-bow",
        reaction === "jump" && "bot-jump",
        reaction === "legUp" && "bot-legup",
        reaction === "antenna" && "bot-flash",
        className,
      )}
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
        {/* 足上げ（#215）で動かす1本。他の部位と独立して動かせるよう、自分だけのクラスを持つ。 */}
        <ellipse className="bot-foot" cx="306" cy="432" rx="31" ry="22" fill={`url(#${uid}-shell)`} />

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
});


/**
 * SVGを先に表示し、3Dの初回描画が成功したときだけ切り替える。
 *
 * **触れる部品なので、装飾ではなくボタンとして置く（#180）。** 絵そのものは
 * `aria-hidden` のままで、名前とキーボード操作を外側のボタンが持つ。押して起きるのは
 * 見た目の反応だけで、**マイク・送信・読み上げには一切触らない**——ここから会話の状態を
 * 変えないという#176の前提をそのまま守っている。
 */
export function Robot({ state, reacting = false, className }: Props) {
  const host = useRef<HTMLSpanElement>(null);
  const controller = useRef<ReturnType<typeof import("./robot-3d/scene").mountRobotScene> | null>(null);
  const [ready, setReady] = useState(false);
  // WebGLが使えずSVGで出ているときの反応。3Dのときは `robot-3d/model.ts` が同じ動きを作る。
  const [fallbackReaction, setFallbackReaction] = useState<FallbackReaction | null>(null);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackBlockedUntil = useRef(0);
  const pressed = useRef<
    { x: number; y: number; at: number; part: RobotPart | null; lastX: number; lastAt: number } | null
  >(null);
  // SVGフォールバックの回転は3Dの `setSpin()` と同じ角度をCSSの `rotateY()` で真似る（#201）。
  const fallbackSvg = useRef<SVGSVGElement>(null);
  /** ドラッグで回した角度（ラジアン）。慣性の間もここへ積み続ける。 */
  const spinAngle = useRef(0);
  /** 直近の角速度（ラジアン/フレーム）。指を離した瞬間の勢いをそのまま慣性へ渡す。 */
  const spinVelocity = useRef(0);
  const spinFrame = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("./robot-3d/scene").then(({ mountRobotScene }) => {
      if (cancelled || !host.current) return;
      controller.current = mountRobotScene(host.current, () => {
        controller.current = null;
        if (!cancelled) setReady(false);
      });
      setReady(true);
    }).catch(() => {
      // GPU非対応・初期化失敗・チャンク取得失敗でも、会話とSVGを継続する。
      if (!cancelled) setReady(false);
    });
    return () => { cancelled = true; controller.current?.dispose(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.setState(state, reacting); }, [state, reacting, ready]);
  // SVGフォールバックで回している最中に3Dの初期化が終わっても、角度を引き継ぐ（#201）。
  useEffect(() => { if (ready) controller.current?.setSpin(spinAngle.current); }, [ready]);
  useEffect(() => () => { if (fallbackTimer.current) clearTimeout(fallbackTimer.current); }, []);

  /*
   * PCではロボットの近くへ来たカーソルを追う。**触るだけの端末では繋がない**——
   * `pointermove` は指が触れている間しか届かず、タップの位置は下の `pointerup` で渡している。
   */
  useEffect(() => {
    if (!ready || !window.matchMedia("(hover: hover)").matches) return;
    const move = (event: PointerEvent) => {
      if (event.pointerType === "mouse") controller.current?.look(event.clientX, event.clientY);
    };
    const leave = () => controller.current?.look();
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
    };
  }, [ready]);

  /**
   * ドラッグで回した角度を3D・SVGフォールバックの両方へ映す（#201）。慣性の計算は
   * ここではなく呼び出し側（下の `startSpinMomentum`）が持つ——3D側の `setSpin()` は
   * 受け取った角度をそのまま描画するだけの薄いAPIにして、視線・会話の状態の合成
   * （`model.ts` の `update()`）とは干渉させない。
   */
  const applySpin = useCallback((radians: number) => {
    controller.current?.setSpin(radians);
    if (fallbackSvg.current) {
      fallbackSvg.current.style.transform = `rotateY(${(radians * 180) / Math.PI}deg)`;
    }
  }, []);

  const stopSpinMomentum = useCallback(() => {
    if (spinFrame.current !== null) {
      cancelAnimationFrame(spinFrame.current);
      spinFrame.current = null;
    }
  }, []);

  /**
   * 指を離した後も、直前の勢いのぶんだけ回り続けさせる。「ぐるぐる回転できる感じ」
   * （Issue本文）はドラッグへの追従だけでは弱く、離した後の惰性があって初めて出る。
   * 動きを減らす設定では、この自動で続く回転そのものを起こさない
   * ——ドラッグに追従する分は操作の結果としてそのまま反映する。
   */
  const startSpinMomentum = useCallback(() => {
    stopSpinMomentum();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const step = () => {
      spinVelocity.current *= SPIN_FRICTION;
      if (Math.abs(spinVelocity.current) < SPIN_MIN_VELOCITY) {
        spinFrame.current = null;
        return;
      }
      spinAngle.current += spinVelocity.current;
      applySpin(spinAngle.current);
      spinFrame.current = requestAnimationFrame(step);
    };
    spinFrame.current = requestAnimationFrame(step);
  }, [applySpin, stopSpinMomentum]);

  useEffect(() => stopSpinMomentum, [stopSpinMomentum]);

  /** 触られた反応を始める。連打しても積み上がらないよう、再生中と待ち時間は受け付けない。 */
  const react = useCallback((part: RobotPart) => {
    if (controller.current) { controller.current.react(part); return; }
    const now = performance.now();
    if (now < fallbackBlockedUntil.current) return;
    fallbackBlockedUntil.current = now + REACTION_MS + REACTION_COOLDOWN_MS;
    // 動きを減らす設定では体を動かさず、アンテナの明るさだけで応える（3D側の `react()` と同じ扱い）。
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // 体を押されたときは、会釈・ジャンプ・足上げのどれかをランダムに選ぶ（#215。3D側の
    // `scene.ts` と同じ `pickBodyReaction()` を使う）。
    setFallbackReaction(reduced ? "antenna" : part === "antenna" ? "antenna" : pickBodyReaction());
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    fallbackTimer.current = setTimeout(() => setFallbackReaction(null), REACTION_MS);
  }, []);

  return (
    <button
      type="button"
      aria-label="秘書のロボット。押すと反応します"
      onPointerDown={event => {
        const now = performance.now();
        pressed.current = {
          x: event.clientX, y: event.clientY, at: now, lastX: event.clientX, lastAt: now,
          // 3Dのときは押された立体の部品で見分ける。SVGのときは体として扱う。
          part: controller.current ? controller.current.partAt(event.clientX, event.clientY) : "body",
        };
        // 回っている途中で掴んだら、いったん惰性を止めて指の動きへ渡す。
        stopSpinMomentum();
        // 画面の外まで指を滑らせても、その先のpointermoveを引き続き受け取るため。
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const down = pressed.current;
        if (!down) return;
        const dx = event.clientX - down.lastX;
        if (dx === 0) return;
        // 横方向の動きだけを回転にする。縦方向（`touch-pan-y`で許した縦スクロール）は使わない。
        spinAngle.current += dx * SPIN_SENSITIVITY;
        applySpin(spinAngle.current);
        const now = performance.now();
        const elapsedFrames = Math.max((now - down.lastAt) / SPIN_FRAME_MS, 1);
        spinVelocity.current = (dx * SPIN_SENSITIVITY) / elapsedFrames;
        down.lastX = event.clientX;
        down.lastAt = now;
      }}
      onPointerUp={event => {
        const down = pressed.current;
        pressed.current = null;
        if (!down) return;
        // 指を滑らせたぶん（＝画面を送っている）は反応にしない。縦スクロールを塞がないため。
        // 3Dモデルに当たらない余白（`down.part === null`）からのドラッグでも回せる。
        if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > TAP_SLOP_PX) {
          startSpinMomentum();
          return;
        }
        if (!down.part) return;
        if (performance.now() - down.at > TAP_HOLD_MS) return;
        if (event.pointerType !== "mouse") controller.current?.look(event.clientX, event.clientY);
        react(down.part);
      }}
      onPointerCancel={() => { pressed.current = null; }}
      onClick={event => {
        // キーボード（Enter・Space）で押された回だけをここで拾う（`detail` が 0 になる）。
        // マウスは `pointerup` で済ませてあり、両方で受けると同じ操作が2回反応する。
        if (event.detail === 0) react("body");
      }}
      className={cn(
        "relative block shrink-0 cursor-pointer touch-pan-y appearance-none border-0 bg-transparent p-0",
        "focus-visible:rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent",
        className,
      )}
      // SVGフォールバックの `rotateY()`（#201）に奥行きを与える。3D側はcanvas自体が立体なので無関係。
      style={{ perspective: "900px" }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-[16%] bottom-[8%] h-[7%] rounded-[50%] bg-black/15 blur-[5px]"
        hidden={!ready}
      />
      <span ref={host} aria-hidden="true" className="absolute inset-0 block" style={{ visibility: ready ? "visible" : "hidden" }} />
      {!ready && (
        <RobotFallback
          ref={fallbackSvg}
          state={state}
          reacting={reacting}
          reaction={fallbackReaction}
          className="h-full w-full"
        />
      )}
    </button>
  );
}
