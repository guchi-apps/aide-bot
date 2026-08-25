import { cn } from "@/lib/utils";

/** 秘書のいまの状態。画面の文言と球の見た目はこの1つの値から決める。 */
export type OrbState = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  state: OrbState;
  /** 声が届いた直後だけ true。聞き取り中に球をひと回り大きくする。 */
  reacting?: boolean;
  className?: string;
};

/**
 * 画面の中央にいる「秘書」。
 *
 * 待っているのか、聞いているのか、考えているのか、話しているのかを、文字を読まなくても
 * 分かるようにするためのもの。見た目はすべて `globals.css` の `.orb` 側に置く——
 * 状態ごとのキーフレームをTailwindのユーティリティでは書けないため。
 */
export function Orb({ state, reacting = false, className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={cn("orb", `orb-${state}`, reacting && "orb-reacting", className)}
    >
      {state === "listening" && (
        <>
          <span className="orb-ring" />
          <span className="orb-ring" />
          <span className="orb-ring" />
        </>
      )}
      {state === "thinking" && <span className="orb-sweep" />}
      <span className="orb-halo" />
      <span className="orb-core" />
    </div>
  );
}
