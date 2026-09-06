import * as THREE from "three";
import type { RobotState } from "../robot";

/**
 * 1フレームぶんの入力（#180）。**姿勢を決める材料はすべてここから渡す。**
 * モデルの側で時刻を数えたり入力を覚えたりしない——描画を止めている間（非表示・画面外）に
 * 位相だけが進むと、戻ってきた瞬間にロボットが跳ねる。
 */
export type RobotDrive = {
  state: RobotState;
  /** 声が届いた直後だけ true。 */
  reacting: boolean;
  /** 揺れ・まばたき・うなずきの位相（秒）。 */
  time: number;
  /** 前のフレームからの経過（秒）。なじませる速さを描画のこま数から切り離す。 */
  delta: number;
  /** 端末の「動きを減らす」設定。 */
  reduced: boolean;
  /** 視線の目標（-1..1）。追う相手がいなければ 0。 */
  lookX: number;
  lookY: number;
  /** 会釈の進み（0=していない、1=終わり）。 */
  bow: number;
  /** ジャンプの進み（0=していない、1=終わり。#215）。 */
  jump: number;
  /** 足上げの進み（0=していない、1=終わり。#215）。 */
  legUp: number;
  /** アンテナの発光の強さ（0..1）。 */
  flash: number;
};

/**
 * 姿勢をなじませる時定数（秒）。3τでほぼ収まるので、0.12なら約0.35秒で落ち着く。
 * うなずき（周期2.6秒）はこの速さならほとんど鈍らない。**まばたきはここを通さない**
 * ——0.15秒で閉じて開くものをなじませると、目が半開きのままになる。
 */
const POSE_TAU = 0.12;
/** 視線をなじませる時定数（秒）。約0.25秒で追いつく。急に振り向かず、せわしなくもならない。 */
const GAZE_TAU = 0.085;
/** 視線に連れて体が向く量（ラジアン）。首が独立していないので、目より控えめにする。 */
const LOOK_YAW = 0.12;
/** 視線の上下に連れて体が傾く量（ラジアン）。 */
const LOOK_PITCH = 0.07;
/** ジャンプで`root`が持ち上がる高さ（世界座標の単位。#215）。 */
const JUMP_HEIGHT = 0.45;
/** 足上げで足が浮く高さ（世界座標の単位。#215）。 */
const LEG_LIFT = 0.24;
/** 足上げのあいだ、体がわずかに傾く量（ラジアン。#215）。 */
const LEG_LEAN = 0.06;

/** 目標へ一定の割合で寄せる。経過時間から割合を出すので、こま数が変わっても速さが変わらない。 */
function approach(current: number, target: number, tau: number, delta: number) {
  return current + (target - current) * (1 - Math.exp(-Math.max(delta, 0) / tau));
}

/** 承認済みのニット外装・茶色のガラス・青い目を持つ、編集可能な立体モデル。 */
export function createRobotModel() {
  const root = new THREE.Group();
  root.name = "AIDE_Bot";
  const body = new THREE.Group();
  body.name = "Body";
  root.add(body);
  const sphere = new THREE.SphereGeometry(1, 64, 40);
  const brown = new THREE.MeshPhysicalMaterial({ color: "#322219", roughness: 0.65, clearcoat: 0.08 });
  const metal = new THREE.MeshStandardMaterial({ color: "#675144", metalness: 0.8, roughness: 0.25 });

  // 小さな繰り返し模様を凹凸として使う。編み目を全てポリゴンにして端末負荷を増やさない。
  const knit = document.createElement("canvas");
  knit.width = knit.height = 128;
  const k = knit.getContext("2d");
  if (!k) throw new Error("Canvas 2D unavailable");
  k.fillStyle = "#555";
  k.fillRect(0, 0, 128, 128);
  k.lineCap = "round";
  for (let row = -1; row < 5; row++) {
    for (let col = -1; col < 5; col++) {
      const x = col * 32, y = row * 32;
      for (const [width, color] of [[12, "#777"], [8, "#bbb"], [3, "#eee"]] as const) {
        k.strokeStyle = color;
        k.lineWidth = width;
        k.beginPath();
        k.moveTo(x + 5, y + 2);
        k.bezierCurveTo(x + 5, y + 13, x + 14, y + 21, x + 16, y + 30);
        k.bezierCurveTo(x + 18, y + 21, x + 27, y + 13, x + 27, y + 2);
        k.stroke();
      }
    }
  }
  /*
   * 編み目の繰り返し回数。**`anisotropy` は実際に材質へ渡すテクスチャに付ける**（#190）。
   * ここには以前この値を持つだけのテクスチャがもう1枚あり、どの材質にも渡っていないのに
   * `anisotropy` だけがそちらに付いていたため、**体の編み目は等方フィルタのまま**だった
   * ——面が視線から傾くほど、繰り返しの細かい模様がざらついて見える。
   */
  const KNIT_REPEAT = new THREE.Vector2(14, 8);
  const KNIT_ANISOTROPY = 4;
  const albedo = document.createElement("canvas");
  albedo.width = albedo.height = 128;
  const a = albedo.getContext("2d")!;
  a.drawImage(knit, 0, 0);
  const pixels = a.getImageData(0, 0, 128, 128);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const value = 190 + pixels.data[i] * 0.23;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  a.putImageData(pixels, 0, 0);
  const knitColor = new THREE.CanvasTexture(albedo);
  knitColor.colorSpace = THREE.SRGBColorSpace;
  knitColor.wrapS = knitColor.wrapT = THREE.RepeatWrapping;
  knitColor.repeat.copy(KNIT_REPEAT);
  knitColor.anisotropy = KNIT_ANISOTROPY;
  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = normalCanvas.height = 128;
  const normalContext = normalCanvas.getContext("2d")!;
  const heights = k.getImageData(0, 0, 128, 128).data;
  const normals = normalContext.createImageData(128, 128);
  const heightAt = (x: number, y: number) => heights[(((y + 128) % 128) * 128 + (x + 128) % 128) * 4] / 255;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const n = new THREE.Vector3(
      (heightAt(x - 1, y) - heightAt(x + 1, y)) * 3,
      (heightAt(x, y + 1) - heightAt(x, y - 1)) * 3, 1,
    ).normalize();
    const i = (y * 128 + x) * 4;
    normals.data[i] = (n.x + 1) * 127.5;
    normals.data[i + 1] = (n.y + 1) * 127.5;
    normals.data[i + 2] = (n.z + 1) * 127.5;
    normals.data[i + 3] = 255;
  }
  normalContext.putImageData(normals, 0, 0);
  const knitNormal = new THREE.CanvasTexture(normalCanvas);
  knitNormal.wrapS = knitNormal.wrapT = THREE.RepeatWrapping;
  knitNormal.repeat.copy(KNIT_REPEAT);
  knitNormal.anisotropy = KNIT_ANISOTROPY;
  const cloth = new THREE.MeshPhysicalMaterial({
    map: knitColor, color: "#efd5af", roughness: 0.95, normalMap: knitNormal, normalScale: new THREE.Vector2(0.7, 0.7),
    sheen: 0.55, sheenColor: new THREE.Color("#fff1dc"), sheenRoughness: 0.9,
  });

  function ellipsoid(name: string, parent: THREE.Group, material: THREE.Material, position: number[], scale: number[]) {
    const mesh = new THREE.Mesh(sphere, material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    mesh.scale.set(scale[0], scale[1], scale[2]);
    parent.add(mesh);
    return mesh;
  }
  /** 足上げ（#215）で動かす1本の足。世界に対してではなく`root`直下の局所座標で動かす。 */
  let liftFoot: THREE.Mesh | null = null;
  const shellGeo = sphere.clone();
  const pos = shellGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const rounded = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.82);
    pos.setXYZ(i, rounded(pos.getX(i)), rounded(pos.getY(i)), rounded(pos.getZ(i)));
  }
  shellGeo.computeVertexNormals();
  const shell = new THREE.Mesh(shellGeo, cloth);
  shell.name = "Knitted_shell";
  shell.position.y = 1.16;
  shell.scale.set(1.1, 0.98, 0.85);
  body.add(shell);
  for (const x of [-0.67, 0.67]) {
    for (const z of [-0.47, 0.47]) {
      const foot = ellipsoid(`Foot_${x}_${z}`, root, brown, [x, 0.17, z], [0.25, 0.17, 0.3]);
      if (x > 0 && z > 0) liftFoot = foot; // 前寄り・右側の1本を足上げの対象にする
    }
    ellipsoid(`Ear_${x}`, body, brown, [Math.sign(x) * 1.08, 1.17, 0], [0.16, 0.34, 0.29]);
  }
  /*
   * アンテナは1つのグループにまとめる（#180）。押された場所が体かアンテナかは、
   * 当たったメッシュの祖先にこのグループがあるかで見分ける——名前の一致で判定すると、
   * 部品を1つ足すたびに判定側の文字列も足すことになる。
   */
  const antenna = new THREE.Group();
  antenna.name = "Antenna";
  body.add(antenna);
  ellipsoid("Antenna_base", antenna, brown, [0, 2.13, 0], [0.25, 0.085, 0.2]);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.27, 20), metal);
  stalk.name = "Antenna_stalk";
  stalk.position.set(0, 2.3, 0);
  antenna.add(stalk);
  const lampMaterial = new THREE.MeshPhysicalMaterial({
    color: "#65d4ff", emissive: "#19a6ee", emissiveIntensity: 0.65,
    roughness: 0.19, clearcoat: 1,
  });
  const lamp = ellipsoid("Antenna_lamp", antenna, lampMaterial, [0, 2.49, 0], [0.105, 0.105, 0.105]);
  /*
   * 指で押せる大きさの当たり判定（#180）。**見えているメッシュを的にすると指では当たらない。**
   * カメラの画角から計算すると、168pxの表示でランプは直径10.7px・アンテナ全体でも約25×28pxで、
   * iOSの推奨44pxを大きく下回る。この楕円は168pxで44.9×46.9px（200pxなら53.4×55.9px）になる。
   * `visible = false` に頼らないのは、three.jsのレイキャストが可視性を見ないためで、
   * 透明な材質で「写らないが当たる」を作っている。
   */
  const hitMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const antennaZone = ellipsoid("Antenna_hit_area", antenna, hitMaterial, [0, 2.4, 0], [0.44, 0.46, 0.44]);
  antennaZone.renderOrder = -1;
  /*
   * 押されたときに広がる光（#180）。**明るさを上げるだけでは足りない。** 168pxの表示だと
   * ランプは4px程度しかなく、実測では発光の前後で絵がほとんど変わらなかった
   * （頭のあたりだけを切り出しても、待機中の揺れと見分けが付かなかった）。
   * ランプの外へはみ出す面を1枚重ねて、触れたことが分かる大きさにする。
   */
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const glowContext = glowCanvas.getContext("2d");
  if (!glowContext) throw new Error("Canvas 2D unavailable");
  const halo = glowContext.createRadialGradient(32, 32, 0, 32, 32, 32);
  halo.addColorStop(0, "rgba(255,255,255,0.95)");
  halo.addColorStop(0.32, "rgba(159,226,255,0.6)");
  halo.addColorStop(1, "rgba(127,208,255,0)");
  glowContext.fillStyle = halo;
  glowContext.fillRect(0, 0, 64, 64);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, transparent: true, opacity: 0, depthWrite: false });
  const glow = new THREE.Sprite(glowMaterial);
  glow.name = "Antenna_glow";
  glow.position.set(0, 2.49, 0);
  glow.scale.set(1.1, 1.1, 1.1);
  glow.visible = false;
  antenna.add(glow);

  // 顔は曲面メッシュ。目と口は画面内の表示なので、同じテクスチャ上で変形させる。
  function roundedPoint(u: number, v: number, width: number, height: number) {
    const r = height * 0.28;
    let x = u * width / 2, y = v * height / 2;
    const dx = Math.abs(x) - (width / 2 - r), dy = Math.abs(y) - (height / 2 - r);
    if (dx > 0 && dy > 0) {
      const factor = Math.max(dx, dy) / Math.hypot(dx, dy);
      x = Math.sign(x) * (width / 2 - r + dx * factor);
      y = Math.sign(y) * (height / 2 - r + dy * factor);
    }
    return [x, y];
  }
  function visorGeometry(width: number, height: number, depth: number) {
    const geometry = new THREE.PlaneGeometry(width, height, 48, 32);
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (width / 2), v = p.getY(i) / (height / 2);
      // 正方形を角丸の輪郭へ写す。UVはそのまま残し、角で顔が欠けるのを避ける。
      const [x, y] = roundedPoint(u, v, width, height);
      p.setXYZ(i, x, y, depth - 0.07 * (x / (width / 2)) ** 2 - 0.025 * (y / (height / 2)) ** 2);
    }
    geometry.computeVertexNormals();
    return geometry;
  }
  const outline = new THREE.Shape();
  const edge: [number, number][] = [];
  for (let i = 0; i <= 24; i++) edge.push([-1 + i / 12, -1]);
  for (let i = 1; i <= 24; i++) edge.push([1, -1 + i / 12]);
  for (let i = 1; i <= 24; i++) edge.push([1 - i / 12, 1]);
  for (let i = 1; i <= 24; i++) edge.push([-1, 1 - i / 12]);
  edge.forEach(([u, v], i) => {
    const [x, y] = roundedPoint(u, v, 1.81, 1.25);
    if (i === 0) outline.moveTo(x, y); else outline.lineTo(x, y);
  });
  outline.closePath();
  const housing = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, {
    depth: 0.16, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2, steps: 1,
  }), brown);
  housing.name = "Display_housing";
  housing.position.set(0, 1.2, 0.65);
  body.add(housing);
  const rim = new THREE.Mesh(visorGeometry(1.81, 1.25, 0.92), brown);
  rim.name = "Visor_frame";
  rim.position.y = 1.2;
  body.add(rim);
  const faceCanvas = document.createElement("canvas");
  faceCanvas.width = 768;
  faceCanvas.height = 512;
  const ctx = faceCanvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  const faceMaterial = new THREE.MeshPhysicalMaterial({
    map: faceTexture, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.12,
    emissive: "#ffffff", emissiveMap: faceTexture, emissiveIntensity: 0.3,
  });
  const face = new THREE.Mesh(visorGeometry(1.7, 1.14, 0.945), faceMaterial);
  face.name = "Glass_display";
  face.position.y = 1.2;
  body.add(face);
  let lastFace = "";
  /**
   * 顔はテクスチャなので、書き換えた回だけGPUへ送り直す。`key` が変わらない回は何もしない
   * ——視線を追っている間は毎フレーム変わるため、目の位置は1px刻みへ丸めてから比べる。
   */
  function paintFace(state: RobotState, time: number, reduced: boolean, eyeOpen: number, gazeX: number, gazeY: number) {
    const phase = time % 6.2;
    // まばたきはなじませた開き具合へ後から掛ける。0.15秒で閉じて開くものをなじませると半開きになる。
    const blink = !reduced && phase > 5.9 ? Math.max(0.08, Math.abs(phase - 6.05) / 0.15) : 1;
    const eyeHeight = eyeOpen * blink;
    const mouthHeight = state === "speaking" && !reduced ? 14 + 13 * (1 + Math.sin(time * 17)) : 15;
    // 目そのものと、その中の光の点を別々に動かす。両方が同じだけ動くと顔ごとずれて見える。
    const eyeShiftX = Math.round(gazeX * 14), eyeShiftY = Math.round(gazeY * 10);
    const pupilX = Math.round(gazeX * 24), pupilY = Math.round(gazeY * 17);
    const key = `${state}:${eyeHeight.toFixed(2)}:${Math.round(mouthHeight)}:${eyeShiftX}:${eyeShiftY}:${pupilX}:${pupilY}`;
    if (key === lastFace) return;
    lastFace = key;
    const bg = ctx!.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, "#241b16"); bg.addColorStop(1, "#382a22");
    ctx!.fillStyle = bg; ctx!.fillRect(0, 0, 768, 512);
    for (const x of [230, 538]) {
      ctx!.save();
      ctx!.translate(x + eyeShiftX, (state === "thinking" ? 229 : 246) + eyeShiftY);
      ctx!.scale(state === "listening" ? 1.06 : 1, eyeHeight);
      ctx!.shadowColor = "#27beff"; ctx!.shadowBlur = 22;
      ctx!.strokeStyle = "#58d0ff"; ctx!.lineWidth = 23;
      ctx!.beginPath(); ctx!.arc(0, 0, 85, 0, Math.PI * 2); ctx!.stroke();
      ctx!.shadowBlur = 0; ctx!.fillStyle = "#0a1720";
      ctx!.beginPath(); ctx!.arc(0, 0, 72, 0, Math.PI * 2); ctx!.fill();
      // 光の点だけは目の中を動く。**縁からはみ出さないよう切り抜いてから描く。**
      ctx!.save();
      ctx!.beginPath(); ctx!.arc(0, 0, 72, 0, Math.PI * 2); ctx!.clip();
      ctx!.fillStyle = "#f4fcff";
      ctx!.beginPath(); ctx!.arc(pupilX - 22, pupilY - 26, 9, 0, Math.PI * 2); ctx!.fill();
      ctx!.restore();
      ctx!.restore();
    }
    ctx!.fillStyle = "#080d10";
    ctx!.beginPath(); ctx!.ellipse(384 + eyeShiftX * 0.5, 397, 40, mouthHeight, 0, 0, Math.PI); ctx!.fill();
    if (state === "thinking" || state === "preparing") {
      for (let i = 0; i < 3; i++) {
        ctx!.fillStyle = state === "thinking" ? "#65d5ff" : "#e9bf83";
        ctx!.beginPath(); ctx!.arc(354 + i * 30, 94, 5, 0, Math.PI * 2); ctx!.fill();
      }
    }
    faceTexture.needsUpdate = true;
  }

  /*
   * いま画面に出ている姿勢（#180）。目標を直接入れず、ここへ寄せていく。
   * 状態が切り替わった回に前の姿勢から続けて動くので、跳ねずに次の仕草へ移る。
   */
  const pose = { pitch: 0, roll: 0, lift: 0, eye: 1, gazeX: 0, gazeY: 0 };

  /**
   * 部位ごとに誰が値を決めるかを固定してある。強い順に **会話の状態 → タップ反応 → 視線追従**で、
   * 上のものが下のものを上書きする。会話の状態がいちばん強いのは、いま聞いているのか考えて
   * いるのかが読めなくなるのがいちばん困るため（Issue #180の「会話状態の分かりやすさを優先する」）。
   */
  function update(d: RobotDrive) {
    const t = d.reduced ? 0 : d.time;
    const sway = Math.sin(t * 1.2);

    // --- 1. 会話の状態。姿勢の土台をここで決める。 ---
    let roll = sway * 0.008, pitch = 0, lift = d.reduced ? 0 : sway * 0.009, eye = 1;
    let lampBase = 0.5 + (d.reduced ? 0 : Math.sin(t * 1.8) * 0.18);
    // 視線を状態の側から差し押さえる指示。null なら追従にまかせる。
    let override: readonly [number, number] | null = null;
    let gazeGain = 1;

    if (d.state === "listening") {
      // 前傾して相手へ寄る。声が届いた回だけさらにひと寄せする。
      pitch = 0.06 + (d.reacting ? 0.035 : 0);
      lift += d.reacting ? 0.028 : 0;
      eye = 1.06;
      lampBase = 0.9 + (d.reduced ? 0 : Math.sin(t * 3) * 0.1);
    } else if (d.state === "thinking") {
      roll = 0.065 + (d.reduced ? 0 : Math.sin(t * 1.8) * 0.025);
      eye = 0.6;
      override = [-0.55, -0.75]; // 考えている間は相手を見ず、斜め上へ視線を外す
    } else if (d.state === "preparing") {
      // 声の出来上がりを待っている間は、正面へ戻って静かにしている。
      override = [0, 0];
      lampBase = 0.55 + (d.reduced ? 0 : Math.sin(t * 4) * 0.3);
    } else if (d.state === "speaking") {
      // うなずきは一定の間隔で頭を落として戻すもの。上下に揺らし続けるのとは違う。
      const nod = d.reduced ? 0 : Math.max(0, Math.sin(t * 2.4));
      pitch = nod * 0.045;
      lift -= nod * 0.03;
      gazeGain = 0.55; // 話している間の追従は弱める。喋りながらきょろきょろしない
      lampBase = 0.6;
    }

    pose.pitch = approach(pose.pitch, pitch, POSE_TAU, d.delta);
    pose.roll = approach(pose.roll, roll, POSE_TAU, d.delta);
    pose.lift = approach(pose.lift, lift, POSE_TAU, d.delta);
    pose.eye = approach(pose.eye, eye, POSE_TAU, d.delta);

    // --- 2. タップ反応。なじませた姿勢の上へそのまま足す（なじませると会釈が鈍る）。 ---
    // 会釈・ジャンプ・足上げは同時に来ない（`scene.ts`がタップのたびに1つだけ選ぶ）。
    const bow = d.bow > 0 ? Math.sin(d.bow * Math.PI) : 0; // 出て、戻る
    const jump = d.jump > 0 ? Math.sin(d.jump * Math.PI) : 0;
    const legRaise = d.legUp > 0 ? Math.sin(d.legUp * Math.PI) : 0;
    if (bow > 0) override = [0, 0.1]; // 会釈の間はこちらを向く
    const lampFlash = d.flash > 0 ? 0.35 + d.flash * 3.2 : 0;

    // --- 3. 視線追従。いちばん弱く、上の2つが向きを決めた回は譲る。 ---
    const goalX = override ? override[0] : d.lookX * gazeGain;
    const goalY = override ? override[1] : d.lookY * gazeGain;
    pose.gazeX = approach(pose.gazeX, goalX, GAZE_TAU, d.delta);
    pose.gazeY = approach(pose.gazeY, goalY, GAZE_TAU, d.delta);

    body.rotation.y = pose.gazeX * LOOK_YAW;
    body.rotation.x = pose.pitch + pose.gazeY * LOOK_PITCH + bow * 0.14;
    body.rotation.z = pose.roll * (1 - bow) - legRaise * LEG_LEAN;
    body.position.y = pose.lift - bow * 0.05;
    // ジャンプはスクワッシュ&ストレッチ付きで伸び縮みさせる。体だけでなく`root`ごと持ち上げ、
    // 4本の足も一緒に地面から離す（`root`直下にあるため）。
    body.scale.set(1 - jump * 0.08, 1 + jump * 0.16, 1 - jump * 0.08);
    root.position.y = jump * JUMP_HEIGHT;
    // 足上げは1本の足だけを`root`直下の局所座標で持ち上げる。他の3本と`root`自体は地面のまま。
    if (liftFoot) {
      liftFoot.position.y = 0.17 + legRaise * LEG_LIFT;
      liftFoot.rotation.x = -legRaise * 0.8;
    }
    lampMaterial.emissiveIntensity = Math.max(lampBase, lampFlash);
    // 光っている間はランプ自体も膨らみ、外へはみ出す光を重ねる。
    // **明るさだけでは気付けない**（この大きさではランプが数pxしかない）。
    const swell = d.reduced ? 1 : 1 + d.flash * 0.55;
    lamp.scale.set(0.105 * swell, 0.105 * swell, 0.105 * swell);
    glow.visible = d.flash > 0;
    glowMaterial.opacity = d.flash * 0.95;
    paintFace(d.state, t, d.reduced, pose.eye, pose.gazeX, pose.gazeY);
  }

  /** 押された場所が体かアンテナかを見分ける。当たらなければ null。 */
  function partAt(raycaster: THREE.Raycaster) {
    const hit = raycaster.intersectObject(root, true)[0];
    if (!hit) return null;
    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) {
      if (node === antenna) return "antenna" as const;
    }
    return "body" as const;
  }

  update({
    state: "idle", reacting: false, time: 0, delta: 0, reduced: true, lookX: 0, lookY: 0,
    bow: 0, jump: 0, legUp: 0, flash: 0,
  });
  function dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(m => materials.add(m));
      }
    });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    // Sprite は Mesh ではないので、上の traverse では拾えない。ここで名指しで手放す。
    glowMaterial.dispose();
    knitNormal.dispose(); knitColor.dispose(); faceTexture.dispose(); glowTexture.dispose();
  }
  return { root, update, partAt, dispose };
}
