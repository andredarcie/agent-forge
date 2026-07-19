// Loads a model module from /models/<name>.js, calls its build() function
// with the AgentForge context, and normalizes the result.
import * as THREE from 'three';
import { mats } from './materials.js';
import { tex } from './textures.js';
import * as helpers from './helpers.js';

export async function loadModel(name) {
  let mod;
  try {
    mod = await import(`/models/${name}.js?t=${Date.now()}`);
  } catch (e) {
    return { error: `Failed to load models/${name}.js\n${e && e.stack ? e.stack : e}` };
  }

  const buildFn = mod.build || mod.default;
  if (typeof buildFn !== 'function') {
    return { error: `models/${name}.js must export a build() function (or a default function).` };
  }

  let root;
  try {
    root = await buildFn({ THREE, mats, helpers, tex });
  } catch (e) {
    return { error: `build() threw while constructing "${name}":\n${e && e.stack ? e.stack : e}` };
  }

  if (!root || !root.isObject3D) {
    return { error: `build() must return a THREE.Object3D (got ${root && root.constructor ? root.constructor.name : typeof root}).` };
  }

  if (!root.name) root.name = name;
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = o.userData.noShadow ? false : true;
      o.receiveShadow = true;
      // PSX guard-rail: the PS1 point-sampled everything. Force nearest
      // filtering and no mipmaps on every texture, wherever it came from.
      const mList = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mList) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const t = m[key];
          if (t && t.isTexture) {
            if (t.magFilter !== THREE.NearestFilter || t.minFilter !== THREE.NearestFilter) {
              t.magFilter = THREE.NearestFilter;
              t.minFilter = THREE.NearestFilter;
              t.generateMipmaps = false;
              t.needsUpdate = true;
            }
          }
        }
      }
    }
  });
  root.updateMatrixWorld(true);

  return { root, meta: mod.meta || {} };
}
