import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createRobotModel } from "./model";
import type { RobotState } from "../robot";

/** 呼び出し元が状態を決める。描画側から音声・通信・会話の状態を変更しない。 */
export function mountRobotScene(host: HTMLElement, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  let model: ReturnType<typeof createRobotModel> | undefined;
  let environment: THREE.WebGLRenderTarget | undefined;
  let pmrem: THREE.PMREMGenerator | undefined;
  let teardown: (() => void) | undefined;
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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
    const render = (now: number) => {
      frame = 0;
      if (dead || document.hidden || !visible) return;
      if (now - lastTime >= 1000 / 30) {
        model!.update(state, reacting, (now - start) / 1000, motion.matches);
        try { renderer.render(scene, camera); } catch { fail(); return; }
        lastTime = now;
      }
      if (!motion.matches) frame = requestAnimationFrame(render);
    };
    const wake = () => {
      cancelAnimationFrame(frame); lastTime = -Infinity;
      if (!dead) frame = requestAnimationFrame(render);
    };
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
