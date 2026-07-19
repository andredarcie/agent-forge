// Shared stage: renderer setup, lighting, ground, and the named-view camera
// system used by both the live viewer and the headless capture page.
//
// Two stages exist:
//   PSX (default) — the tool's native look: no tone mapping, no shadow maps
//     (the PS1 had neither), simple directional+hemisphere lighting tuned for
//     Lambert/Phong, a checkerboard floor, a blob shadow under the model and
//     distance fog. Combined with PSXPost + vertex snapping this IS the
//     PS1 presentation.
//   HD (--hd) — the legacy PBR studio (IBL, ACES, soft shadows). Use it only
//     to debug raw geometry; it is NOT how a PSX model should be judged.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tex } from './textures.js';

export const PSX_BACKGROUND = 0x232336; // dusk indigo — classic PSX menu vibe

export function setupRenderer(renderer, { psx = true } = {}) {
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (psx) {
    renderer.toneMapping = THREE.NoToneMapping; // PS1: raw framebuffer colors
    renderer.shadowMap.enabled = false;         // PS1: no shadow maps, ever
  } else {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }
}

export function createStage(renderer, { psx = true, background } = {}) {
  return psx ? createPSXStage(renderer, { background }) : createHDStage(renderer, { background });
}

// ---------------------------------------------------------------------------
// PSX stage
// ---------------------------------------------------------------------------
function createPSXStage(renderer, { background = PSX_BACKGROUND } = {}) {
  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(background);
  scene.background = bgColor;
  scene.fog = new THREE.Fog(bgColor, 10, 60); // distances re-fit per model

  // Lambert/Phong lighting: warm key, cool fill, back light, hemisphere
  // ambience. Tuned so every ortho view stays readable — the PSX mood comes
  // from the palette and dither, not from underexposure.
  const hemi = new THREE.HemisphereLight(0xccd4ff, 0x5a5570, 1.25);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff2e0, 2.4);
  key.position.set(3, 5, 2.5);
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight(0xaab8e0, 1.0);
  fill.position.set(-4, 2.5, -1.5);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xb8c0e8, 0.8);
  back.position.set(1, 3, -4);
  scene.add(back);

  // Checkerboard floor (unlit, subtle, darker than the model plane, with
  // baked photographic grime) + a flat blob shadow — how a PS1 game grounds
  // an object. 2 cells per tile; fit() sets the repeat.
  const checkerTex = tex.checker(0x3a3a52, 0x303046, { cells: 2, dirty: 0.16 });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: checkerTex })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(1, 20),
    new THREE.MeshBasicMaterial({ color: 0x0a0a12, transparent: true, opacity: 0.45, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  scene.add(blob);

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x25303c, wireframe: true });

  const stage = {
    psx: true,
    scene,
    floor,
    blob,
    grid: { visible: false }, // API compat with the HD stage
    backgroundColor: bgColor,
    lights: { key, fill, back, hemi },
    fit(box) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.001);

      const floorSize = radius * 24;
      floor.position.set(center.x, box.min.y - radius * 0.002, center.z);
      floor.scale.setScalar(floorSize);
      // one checker cell ≈ half the model radius, aligned to the tiny 2x2 map
      const cell = Math.max(radius * 0.5, 0.01);
      checkerTex.repeat.setScalar(floorSize / (cell * 2));
      checkerTex.needsUpdate = true;

      blob.position.set(center.x, box.min.y + radius * 0.002, center.z);
      blob.scale.set(Math.max(size.x, 0.001) * 0.62, Math.max(size.z, 0.001) * 0.62, 1);

      scene.fog.near = radius * 7;
      scene.fog.far = radius * 20;

      key.position.set(center.x + radius * 2.2, box.max.y + radius * 2.8, center.z + radius * 1.8);
      key.target.position.copy(center);
    },
    setWireframe(on) {
      scene.overrideMaterial = on ? wireMat : null;
    },
    setGround(on) {
      floor.visible = on;
      blob.visible = on;
    },
    setGrid() { /* no grid in PSX mode — the checker floor is the reference */ },
  };
  return stage;
}

// ---------------------------------------------------------------------------
// HD (legacy PBR studio) stage — geometry debugging only
// ---------------------------------------------------------------------------
function createHDStage(renderer, { background = 0xe9ecf0 } = {}) {
  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(background);
  scene.background = bgColor;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;

  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0xb0a090, 0.5);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff4e6, 2.6);
  key.position.set(3, 5, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xdfeaff, 0.7);
  fill.position.set(-4, 2.5, -1.5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.9);
  rim.position.set(-1, 3.5, -4);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.ShadowMaterial({ opacity: 0.26 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(2, 20, 0xb7bec8, 0xd2d8df);
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x25303c, wireframe: true });

  const stage = {
    psx: false,
    scene,
    floor,
    grid,
    backgroundColor: bgColor,
    lights: { key, fill, rim, hemi },
    fit(box) {
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.length() / 2, 0.001);

      floor.position.set(center.x, box.min.y - radius * 0.0015, center.z);
      floor.scale.setScalar(radius * 4);
      grid.position.set(center.x, box.min.y, center.z);
      const gridSize = Math.max(1, Math.ceil(radius * 3));
      grid.scale.setScalar(gridSize / 2); // GridHelper base size is 2

      key.position.set(center.x + radius * 2.2, box.max.y + radius * 2.8, center.z + radius * 1.8);
      key.target.position.copy(center);
      const cam = key.shadow.camera;
      cam.left = -radius * 2.2; cam.right = radius * 2.2;
      cam.top = radius * 2.2; cam.bottom = -radius * 2.2;
      cam.near = 0.01; cam.far = radius * 12;
      cam.updateProjectionMatrix();
    },
    setWireframe(on) {
      scene.overrideMaterial = on ? wireMat : null;
    },
    setGround(on) {
      floor.visible = on;
    },
    setGrid(on) {
      grid.visible = on;
    },
  };
  return stage;
}

// Named views. dir = camera offset direction from the model center.
// planeDims maps the model bounding-box size to the [width, height] visible
// in an orthographic projection of that view.
export const VIEWS = {
  persp:  { type: 'persp', dir: [1, 0.62, 1],   label: 'PERSP 3/4 FRONT' },
  persp2: { type: 'persp', dir: [-1, 0.5, -1],  label: 'PERSP 3/4 BACK' },
  front:  { type: 'ortho', dir: [0, 0, 1],  planeDims: (s) => [s.x, s.y], label: 'FRONT ortho' },
  back:   { type: 'ortho', dir: [0, 0, -1], planeDims: (s) => [s.x, s.y], label: 'BACK ortho' },
  right:  { type: 'ortho', dir: [1, 0, 0],  planeDims: (s) => [s.z, s.y], label: 'RIGHT ortho' },
  left:   { type: 'ortho', dir: [-1, 0, 0], planeDims: (s) => [s.z, s.y], label: 'LEFT ortho' },
  top:    { type: 'ortho', dir: [0, 1, 0],  up: [0, 0, -1], planeDims: (s) => [s.x, s.z], label: 'TOP ortho' },
  bottom: { type: 'ortho', dir: [0, -1, 0], up: [0, 0, 1],  planeDims: (s) => [s.x, s.z], floor: false, label: 'BOTTOM ortho' },
  wire:   { type: 'persp', dir: [1, 0.62, 1], wireframe: true, floor: false, grid: false, label: 'WIREFRAME' },
};

// 8-step turntable views (45° increments, slightly elevated).
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  VIEWS[`turn${i}`] = {
    type: 'persp',
    dir: [Math.sin(a + Math.PI / 4), 0.45, Math.cos(a + Math.PI / 4)],
    label: `TURNTABLE ${i * 45}°`,
  };
}

export function makeViewCamera(view, box, aspect) {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.001);
  const dir = new THREE.Vector3(...view.dir).normalize();

  if (view.type === 'persp') {
    const fov = 32;
    const vHalf = THREE.MathUtils.degToRad(fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * aspect);
    const dist = (radius * 1.12) / Math.sin(Math.min(vHalf, hHalf));
    const cam = new THREE.PerspectiveCamera(fov, aspect, dist * 0.01, dist + radius * 30);
    cam.position.copy(center).addScaledVector(dir, dist);
    cam.lookAt(center);
    cam.updateProjectionMatrix();
    return cam;
  }

  // Orthographic: fit the projected bounding-box plane with a margin.
  const margin = 1.12;
  const [w, h] = view.planeDims(size);
  let halfW = (Math.max(w, 0.001) / 2) * margin;
  let halfH = (Math.max(h, 0.001) / 2) * margin;
  if (halfW / halfH < aspect) halfW = halfH * aspect;
  else halfH = halfW / aspect;

  const dist = radius * 4;
  const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.001, dist * 2 + radius * 8);
  cam.position.copy(center).addScaledVector(dir, dist);
  if (view.up) cam.up.set(...view.up);
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  return cam;
}
