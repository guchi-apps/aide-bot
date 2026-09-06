/**
 * 体を押されたときの反応の種類（#215）。3D（`robot-3d/scene.ts`）とSVGフォールバック
 * （`robot.tsx`）の両方が同じ確率で選ぶための共有モジュール。
 *
 * **three.jsに依存しない、独立したファイルにする。** `robot.tsx`はWebGLが使えない端末での
 * 表示に使うため、three.jsを持ち込む`robot-3d/scene.ts`を直接importできない
 * ——importした時点でSVGフォールバック側のバンドルにもthree.jsが混ざり、
 * 「3Dの初期化に失敗した端末でも会話とSVGを継続する」という設計が崩れる。
 */
export type BodyReactionKind = "bow" | "jump" | "legUp";

const BODY_REACTIONS: readonly BodyReactionKind[] = ["bow", "jump", "legUp"];

/** 体を押されるたびに、会釈・ジャンプ・足上げのどれかをランダムに選ぶ。 */
export function pickBodyReaction(): BodyReactionKind {
  return BODY_REACTIONS[Math.floor(Math.random() * BODY_REACTIONS.length)];
}
