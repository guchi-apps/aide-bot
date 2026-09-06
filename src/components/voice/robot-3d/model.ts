import * as THREE from "three";
import type { RobotState } from "../robot";

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
  const knitTexture = new THREE.CanvasTexture(knit);
  knitTexture.wrapS = knitTexture.wrapT = THREE.RepeatWrapping;
  knitTexture.repeat.set(14, 8);
  knitTexture.anisotropy = 4;
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
  knitColor.repeat.copy(knitTexture.repeat);
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
  knitNormal.repeat.copy(knitTexture.repeat);
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
      ellipsoid(`Foot_${x}_${z}`, root, brown, [x, 0.17, z], [0.25, 0.17, 0.3]);
    }
    ellipsoid(`Ear_${x}`, body, brown, [Math.sign(x) * 1.08, 1.17, 0], [0.16, 0.34, 0.29]);
  }
  ellipsoid("Antenna_base", body, brown, [0, 2.13, 0], [0.25, 0.085, 0.2]);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.032, 0.27, 20), metal);
  stalk.name = "Antenna_stalk";
  stalk.position.set(0, 2.3, 0);
  body.add(stalk);
  const lampMaterial = new THREE.MeshPhysicalMaterial({
    color: "#65d4ff", emissive: "#19a6ee", emissiveIntensity: 0.65,
    roughness: 0.19, clearcoat: 1,
  });
  ellipsoid("Antenna_lamp", body, lampMaterial, [0, 2.49, 0], [0.105, 0.105, 0.105]);

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
  function paintFace(state: RobotState, time: number, reduced: boolean) {
    const phase = time % 6.2;
    const blink = !reduced && phase > 5.9 ? Math.max(0.08, Math.abs(phase - 6.05) / 0.15) : 1;
    const eyeHeight = (state === "thinking" ? 0.6 : 1) * blink;
    const mouthHeight = state === "speaking" && !reduced ? 14 + 13 * (1 + Math.sin(time * 17)) : 15;
    const key = `${state}:${eyeHeight.toFixed(2)}:${Math.round(mouthHeight)}`;
    if (key === lastFace) return;
    lastFace = key;
    const bg = ctx!.createLinearGradient(0, 0, 0, 512);
    bg.addColorStop(0, "#241b16"); bg.addColorStop(1, "#382a22");
    ctx!.fillStyle = bg; ctx!.fillRect(0, 0, 768, 512);
    for (const x of [230, 538]) {
      ctx!.save();
      ctx!.translate(x, state === "thinking" ? 229 : 246);
      ctx!.scale(state === "listening" ? 1.06 : 1, eyeHeight);
      ctx!.shadowColor = "#27beff"; ctx!.shadowBlur = 22;
      ctx!.strokeStyle = "#58d0ff"; ctx!.lineWidth = 23;
      ctx!.beginPath(); ctx!.arc(0, 0, 85, 0, Math.PI * 2); ctx!.stroke();
      ctx!.shadowBlur = 0; ctx!.fillStyle = "#0a1720";
      ctx!.beginPath(); ctx!.arc(0, 0, 72, 0, Math.PI * 2); ctx!.fill();
      ctx!.fillStyle = "#f4fcff";
      ctx!.beginPath(); ctx!.arc(-22, -26, 9, 0, Math.PI * 2); ctx!.fill();
      ctx!.restore();
    }
    ctx!.fillStyle = "#080d10";
    ctx!.beginPath(); ctx!.ellipse(384, 397, 40, mouthHeight, 0, 0, Math.PI); ctx!.fill();
    if (state === "thinking" || state === "preparing") {
      for (let i = 0; i < 3; i++) {
        ctx!.fillStyle = state === "thinking" ? "#65d5ff" : "#e9bf83";
        ctx!.beginPath(); ctx!.arc(354 + i * 30, 94, 5, 0, Math.PI * 2); ctx!.fill();
      }
    }
    faceTexture.needsUpdate = true;
  }
  function update(state: RobotState, reacting: boolean, time: number, reduced = false) {
    const t = reduced ? 0 : time;
    body.rotation.z = state === "thinking" ? 0.065 + Math.sin(t * 1.8) * 0.025 : Math.sin(t * 1.2) * 0.008;
    body.rotation.x = state === "listening" ? 0.06 + (reacting ? 0.035 : 0) : state === "speaking" ? Math.sin(t * 5) * 0.023 : 0;
    body.position.y = reduced ? 0 : Math.sin(t * 1.2) * 0.009;
    lampMaterial.emissiveIntensity = (state === "listening" ? 0.9 : 0.5) + (reduced ? 0 : Math.sin(t * (state === "preparing" ? 4 : 1.8)) * 0.18);
    paintFace(state, t, reduced);
  }
  update("idle", false, 0, true);
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
    knitTexture.dispose(); knitNormal.dispose(); knitColor.dispose(); faceTexture.dispose();
  }
  return { root, update, dispose };
}
