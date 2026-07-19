// Visibility analysis (ID pass): renders the model from the 8 standard view
// directions with a unique flat color per mesh, reads back the pixels and
// counts per-part coverage. Detects parts that are swallowed inside other
// geometry or hidden from every practical viewing angle — errors a bounding
// box or contact check cannot see.
import * as THREE from 'three';
import { VIEWS, makeViewCamera } from './stage.js';

const ID_VIEWS = ['persp', 'persp2', 'front', 'back', 'right', 'left', 'top', 'bottom'];
const RT_SIZE = 320;

// Palette values chosen far apart so nearest-match decoding is immune to
// rounding/colorspace drift in the readback.
const STEPS = [0.0, 0.25, 0.5, 0.75, 1.0];
function idToColor(i) {
  const n = STEPS.length;
  const r = STEPS[(i + 1) % n];
  const g = STEPS[Math.floor((i + 1) / n) % n];
  const b = STEPS[Math.floor((i + 1) / (n * n)) % n];
  return [r, g, b];
}

function pathOf(o, root) {
  const parts = [];
  let n = o;
  while (n && n !== root) {
    parts.unshift(n.name || `<unnamed ${n.type}>`);
    n = n.parent;
  }
  return parts.join('/');
}

export function analyzeVisibility(renderer, scene, root, frameBox) {
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
  if (!meshes.length) return { perPart: {}, issues: [] };
  if (meshes.length > 100) {
    return { skipped: 'too many meshes', perPart: {}, issues: [{ level: 'info', message: 'Visibility analysis skipped: >100 meshes.' }] };
  }

  // Swap in unique flat ID materials.
  const saved = meshes.map((m) => ({ m, material: m.material }));
  const idMats = meshes.map((m, i) => {
    const [r, g, b] = idToColor(i);
    const mat = new THREE.MeshBasicMaterial();
    mat.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
    mat.toneMapped = false;
    mat.side = THREE.DoubleSide;
    return mat;
  });
  meshes.forEach((m, i) => { m.material = idMats[i]; });

  const savedState = {
    background: scene.background,
    environment: scene.environment,
    toneMapping: renderer.toneMapping,
    target: renderer.getRenderTarget(),
  };
  scene.background = new THREE.Color(0x000000);
  scene.environment = null;
  renderer.toneMapping = THREE.NoToneMapping;

  const rt = new THREE.WebGLRenderTarget(RT_SIZE, RT_SIZE, { depthBuffer: true });
  const pixels = new Uint8Array(RT_SIZE * RT_SIZE * 4);
  const counts = meshes.map(() => ({}));
  const totalPx = RT_SIZE * RT_SIZE;

  try {
    for (const viewName of ID_VIEWS) {
      const cam = makeViewCamera(VIEWS[viewName], frameBox, 1);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, RT_SIZE, RT_SIZE, pixels);

      const viewCounts = new Map();
      for (let p = 0; p < pixels.length; p += 4) {
        const r = pixels[p] / 255, g = pixels[p + 1] / 255, b = pixels[p + 2] / 255;
        if (r < 0.11 && g < 0.11 && b < 0.11) continue; // background
        // nearest palette id
        let best = -1, bestD = Infinity;
        for (let i = 0; i < meshes.length; i++) {
          const [er, eg, eb] = idToColor(i);
          const d = (r - er) * (r - er) + (g - eg) * (g - eg) + (b - eb) * (b - eb);
          if (d < bestD) { bestD = d; best = i; }
        }
        if (best >= 0 && bestD < 0.02) viewCounts.set(best, (viewCounts.get(best) || 0) + 1);
      }
      for (const [i, c] of viewCounts) counts[i][viewName] = c;
    }
  } finally {
    rt.dispose();
    renderer.setRenderTarget(savedState.target);
    renderer.toneMapping = savedState.toneMapping;
    scene.background = savedState.background;
    scene.environment = savedState.environment;
    saved.forEach(({ m, material }) => { m.material = material; });
    idMats.forEach((m) => m.dispose());
  }

  const perPart = {};
  const issues = [];
  meshes.forEach((m, i) => {
    const views = counts[i];
    const seen = Object.keys(views);
    const total = seen.reduce((s, v) => s + views[v], 0);
    const path = pathOf(m, root);
    perPart[path] = { visibleInViews: seen.length, totalPixels: total, perView: views };

    if (total === 0) {
      if (m.userData.interior) {
        issues.push({
          level: 'info',
          message: `"${path}" is not visible from any standard view (marked interior:true — intentional).`,
        });
      } else {
        issues.push({
          level: 'error',
          message: `INVISIBLE PART: "${path}" cannot be seen from any of the 8 standard views — it is fully ` +
            `swallowed inside other geometry or misplaced. Remove it, fix its position, or set ` +
            `part.userData.interior = true if it is intentionally enclosed.`,
          parts: [m.name || path],
        });
      }
    } else if (!m.userData.interior && seen.length <= 2 && total / (seen.length * totalPx) < 0.004) {
      issues.push({
        level: 'warn',
        message: `MOSTLY HIDDEN: "${path}" is visible in only ${seen.length}/8 views (${total}px total). ` +
          `If it should be visible, it is buried or blocked by other parts; verify with --focus ${m.name || 'PartName'}.`,
        parts: [m.name || path],
      });
    }
  });

  return { perPart, issues };
}
