// Shared stage: renderer setup, lighting, ground, and the named-view camera
// system used by both the live viewer and the headless capture page.
//
// One stage: a neutral PBR studio built to judge low-poly form. Image-based
// lighting from a room environment so faceted surfaces read their planes,
// a warm key with soft shadows to seat the model on the ground, a cool fill
// and a rim to keep the silhouette separated from the background, ACES tone
// mapping. The point is that facets, proportions and silhouette are legible —
// nothing here stylizes the model.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export const STUDIO_BACKGROUND = 0xe9ecf0; // soft neutral grey

export function setupRenderer(renderer) {
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

export function createStage(renderer, { background = STUDIO_BACKGROUND } = {}) {
  const scene = new THREE.Scene();
  const bgColor = new THREE.Color(background);
  scene.background = bgColor;

  // Image-based lighting. Low-poly models live or die by how their flat
  // planes catch light, and an environment gives every facet a slightly
  // different value even where no direct light reaches it.
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

  // Shadow-only floor: grounds the model without introducing a surface color
  // that would compete with it.
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

  return {
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
