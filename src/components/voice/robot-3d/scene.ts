import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRobotModel } from "./model";
import type { RobotState } from "../robot";

/** 触られなくなってから正面へ戻り始めるまで（ミリ秒）。 */
const LOOK_TIMEOUT_MS = 2500;
/** 会釈の長さ（ミリ秒）。 */
const BOW_MS = 700;
/** アンテナが光っている長さ（ミリ秒）。 */
const FLASH_MS = 600;
/** 反応が終わってから次を受け付けるまで（ミリ秒）。連打で動きが積み上がらないようにする。 */
const REACTION_COOLDOWN_MS = 400;

/** 触れた場所。体を押せば会釈、アンテナを押せば発光。 */
export type RobotPart = "body" | "antenna";

/** 呼び出し元が状態を決める。描画側から音声・通信・会話の状態を変更しない。 */
export function mountRobotScene(host: HTMLElement, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  let model: ReturnType<typeof createRobotModel> | undefined;
  let environment: THREE.WebGLRenderTarget | undefined;
  let pmrem: THREE.PMREMGenerator | undefined;
  let teardown: (() => void) | undefined;
  try {
    /*
     * 端末の画素密度どおりに描く（#190）。**上限を下げて描いた絵はブラウザが引き伸ばすので、
     * そのぶんそのまま粗く見える**——DPR 3のiPhoneで上限1.5だと、168pxの枠を252²で描いて
     * 504²へ2倍に拡大していた（Issueの画像はこの状態）。増えるのは塗る画素だけで、
     * 頂点数・描画回数・30fps上限・画面外での停止は変わらない。3で頭を打たせているのは、
     * DPR 4以上を名乗る端末で描画の面積が青天井にならないようにするため。
     */
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.setClearColor(0, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
    const scene = new THREE.Scene();
    const room = new RoomEnvironment();
    pmrem = new THREE.PMREMGenerator(renderer);
    environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    model = createRobotModel();
    model.root.rotation.y = -0.17;
    scene.add(model.root);
    scene.add(new THREE.HemisphereLight(0xfff4e2, 0x6e6257, 0.9));
    const key = new THREE.DirectionalLight(0xfff5e6, 2);
    key.position.set(-3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0xdaf2ff, 0.6);
    fill.position.set(3, 2, -3); scene.add(fill);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(0, 1.65, 5.8); camera.lookAt(0, 1.3, 0);
    let state: RobotState = "idle", reacting = false, frame = 0, lastTime = -Infinity;
    let visible = true, dead = false;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const start = performance.now();
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    /*
     * 追っている相手の画面上の位置（#180）。**目標の角度ではなく生の座標で持つ。**
     * 画面の大きさは折りたたみ・回転で変わるので、角度は描画のたびに今の枠から出し直す。
     */
    let pointer: { x: number; y: number } | null = null;
    let pointedAt = -Infinity, bowAt = -Infinity, flashAt = -Infinity, blockedUntil = 0;
    /** 反応が終わるまで（ミリ秒）。動きを減らす設定でも、この間だけは描画を続ける。 */
    const activeUntil = () => Math.max(bowAt + BOW_MS, flashAt + FLASH_MS);

    /** 画面の座標を、ロボットの中心から見た -1..1 の向きへ直す。遠いカーソルは追わない。 */
    const lookTarget = () => {
      if (!pointer || motion.matches) return { x: 0, y: 0 };
      const box = renderer.domElement.getBoundingClientRect();
      if (!box.width || !box.height) return { x: 0, y: 0 };
      // 追う範囲はロボットの大きさで決める。画面が広いほど遠くまで追う、にはしない。
      const reach = box.width * 1.6;
      const x = (pointer.x - (box.left + box.width / 2)) / reach;
      const y = (pointer.y - (box.top + box.height * 0.56)) / (reach * 0.7);
      const distance = Math.hypot(x, y);
      // 近くにいる間だけ効かせ、境目では徐々に抜く。急に正面へ戻ると跳ねて見える。
      const falloff = distance > 1.25 ? 0 : distance > 0.85 ? (1.25 - distance) / 0.4 : 1;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v * 1.5)) * falloff;
      return { x: clamp(x), y: clamp(y) };
    };

    const render = (now: number) => {
      frame = 0;
      if (dead || document.hidden || !visible) return;
      if (now - lastTime >= 1000 / 30) {
        // 描画を止めていた間ぶんは進めない。戻ってきた回に一気に動くのを避ける。
        const delta = lastTime === -Infinity ? 0 : Math.min((now - lastTime) / 1000, 0.2);
        if (pointer && now - pointedAt > LOOK_TIMEOUT_MS) pointer = null;
        const look = lookTarget();
        const bow = now - bowAt < BOW_MS ? (now - bowAt) / BOW_MS : 0;
        const flash = now - flashAt < FLASH_MS ? 1 - (now - flashAt) / FLASH_MS : 0;
        model!.update({
          state, reacting, time: (now - start) / 1000, delta, reduced: motion.matches,
          lookX: look.x, lookY: look.y, bow, flash,
        });
        try { renderer.render(scene, camera); } catch { fail(); return; }
        lastTime = now;
      }
      if (!motion.matches || now < activeUntil()) frame = requestAnimationFrame(render);
    };
    const wake = () => {
      cancelAnimationFrame(frame); lastTime = -Infinity;
      if (!dead) frame = requestAnimationFrame(render);
    };
    /*
     * 止まっていれば描画を再開する。**`wake()` と違って時計を戻さない**（#180）——
     * カーソルが動くたびに `lastTime` を戻すと毎フレームの経過が 0 になり、
     * 目標へ寄せる処理が一度も進まないまま視線が固まる。
     */
    const resume = () => { if (!dead && !frame) frame = requestAnimationFrame(render); };
    const resize = new ResizeObserver(() => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height; camera.updateProjectionMatrix(); wake();
    });
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; wake(); });
    const lost = (event: Event) => { event.preventDefault(); fail(); };
    const cleanup = () => {
      if (dead) return;
      dead = true; cancelAnimationFrame(frame);
      resize.disconnect(); intersection.disconnect();
      document.removeEventListener("visibilitychange", wake);
      motion.removeEventListener("change", wake);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      model!.dispose(); environment!.dispose(); pmrem!.dispose();
      renderer.dispose(); renderer.domElement.remove();
    };
    function fail() { cleanup(); onFailure(); }
    teardown = cleanup;
    host.appendChild(renderer.domElement);
    renderer.domElement.addEventListener("webglcontextlost", lost);
    document.addEventListener("visibilitychange", wake);
    motion.addEventListener("change", wake);
    resize.observe(host); intersection.observe(host);
    renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1), false);
    renderer.render(scene, camera);
    wake();
    return {
      setState(next: RobotState, response: boolean) { state = next; reacting = response; wake(); },
      /** 画面の座標へ視線を向ける。渡さなければ追うのをやめて正面へ戻る。 */
      look(clientX?: number, clientY?: number) {
        // 動きを減らす設定では追わない。ここで戻らないと、カーソルが動くたびに
        // 止めてあるはずの描画を1こまずつ起こしてしまう。
        if (motion.matches) return;
        pointer = clientX === undefined || clientY === undefined ? null : { x: clientX, y: clientY };
        pointedAt = performance.now();
        resume();
      },
      /** その座標にあるのが体かアンテナかを返す。当たっていなければ null。 */
      partAt(clientX: number, clientY: number): RobotPart | null {
        const box = renderer.domElement.getBoundingClientRect();
        if (!box.width || !box.height) return null;
        ndc.set(((clientX - box.left) / box.width) * 2 - 1, -((clientY - box.top) / box.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        return model!.partAt(raycaster);
      },
      /**
       * 触られた反応を始める。再生中と、その後の待ち時間のあいだは受け付けない
       * （連打しても動きが積み上がらないようにする）。始めたときだけ true を返す。
       */
      react(part: RobotPart) {
        const now = performance.now();
        if (now < blockedUntil) return false;
        // 動きを減らす設定では体を動かさず、アンテナの明るさだけで応える。
        const kind = motion.matches ? "antenna" : part;
        if (kind === "antenna") flashAt = now; else bowAt = now;
        blockedUntil = activeUntil() + REACTION_COOLDOWN_MS;
        resume();
        return true;
      },
      dispose: cleanup,
    };
  } catch (error) {
    if (teardown) teardown();
    else {
      model?.dispose(); environment?.dispose(); pmrem?.dispose(); renderer.dispose();
      renderer.domElement.remove();
    }
    throw error;
  }
}
