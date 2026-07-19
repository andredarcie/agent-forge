// PSX material preset library. Every factory returns a FRESH material tuned
// for the PS1-era pipeline: MeshLambertMaterial (diffuse-only) or
// MeshPhongMaterial (gouraud-style specular for "shiny" parts). Everything is
// flat-shaded by default — pass { flatShading: false } for smooth gouraud on
// organic shapes. NO PBR materials: MeshStandard/MeshPhysical break the look
// and are flagged by the analyzer.
//
// REALISM DEFAULT: PS1 games textured everything with digitized photos, so
// every lit preset automatically carries a subtle grayscale "photo grain"
// map (multiplied under the preset color) — flat cartoon fills don't exist
// here. Pass your own texture with { map: tex.wood(...) } to replace it, or
// { map: null } to force a clean flat color.
//
// All presets accept a color (hex number or CSS string) and an overrides
// object merged into the material parameters.
import * as THREE from 'three';
import { tex } from './textures.js';

// Shared grayscale grain maps (multiply ≈ 1.0 on average; tint stays true).
// One instance per kind, generated on demand.
const _grain = {};
function grain(kind) {
  if (_grain[kind]) return _grain[kind];
  const make = {
    fine:   () => tex.noise(0xffffff, { amount: 0.16, seed: 11 }),       // plastics, paint, ceramics
    blotch: () => tex.grunge(0xffffff, { amount: 0.2, seed: 12 }),       // matte, rubber, fabric
    streak: () => tex.metalWorn(0xffffff, { seed: 13 }),                 // metals
    wood:   () => tex.wood(0xffffff, { seed: 14, planks: 1 }),           // wood tones
  }[kind];
  return (_grain[kind] = make());
}

// 'map' in overrides always wins (including map: null for a clean fill).
function withGrain(kind, overrides) {
  return overrides && 'map' in overrides ? overrides.map : grain(kind);
}

function lambert(name, grainKind, params, overrides = {}) {
  const m = new THREE.MeshLambertMaterial({
    flatShading: true,
    map: grainKind ? withGrain(grainKind, overrides) : (overrides.map ?? null),
    ...params,
    ...overrides,
  });
  m.name = overrides.name || name;
  return m;
}

function phong(name, grainKind, params, overrides = {}) {
  const m = new THREE.MeshPhongMaterial({
    flatShading: true,
    map: grainKind ? withGrain(grainKind, overrides) : (overrides.map ?? null),
    ...params,
    ...overrides,
  });
  m.name = overrides.name || name;
  return m;
}

export const mats = {
  // -- Plastics / matte surfaces (Lambert: pure diffuse) --------------------
  plastic: (color = 0x4a90d9, o) => lambert('plastic', 'fine', { color }, o),
  glossyPlastic: (color = 0xd94a4a, o) =>
    phong('glossyPlastic', 'fine', { color, shininess: 30, specular: 0x555555 }, o),
  matte: (color = 0x9aa0a6, o) => lambert('matte', 'blotch', { color }, o),
  rubber: (color = 0x2b2b2e, o) => lambert('rubber', 'blotch', { color }, o),

  // -- Metals (Phong: gouraud specular hotspot, very PS1) -------------------
  metal: (color = 0xb8bcc4, roughness = 0.35, o) =>
    phong('metal', 'streak', { color, specular: 0x888888, shininess: Math.round((1 - roughness) * 90) + 10 }, o),
  chrome: (o) => phong('chrome', 'streak', { color: 0xd8dce4, specular: 0xffffff, shininess: 90 }, o),
  brushedMetal: (color = 0xa8acb4, o) =>
    phong('brushedMetal', 'streak', { color, specular: 0x555566, shininess: 14 }, o),
  gold: (o) => phong('gold', 'streak', { color: 0xd9b24a, specular: 0xfff0a0, shininess: 55 }, o),
  brass: (o) => phong('brass', 'streak', { color: 0xc8a24a, specular: 0xffe8a0, shininess: 42 }, o),
  copper: (o) => phong('copper', 'streak', { color: 0xc87850, specular: 0xffb890, shininess: 42 }, o),
  paintedMetal: (color = 0x33691e, o) =>
    phong('paintedMetal', 'fine', { color, specular: 0x444444, shininess: 35 }, o),

  // -- Glass / ceramics (PS1 semi-transparency: opacity blending) -----------
  // Glass stays clean (no grain) — grime on glass looked wrong on PS1 too.
  glass: (color = 0xa8d8e8, o) =>
    phong('glass', null, {
      color, specular: 0xffffff, shininess: 90,
      transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false,
    }, o),
  frostedGlass: (color = 0xcfdce4, o) =>
    phong('frostedGlass', null, {
      color, specular: 0x888888, shininess: 18,
      transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false,
    }, o),
  ceramic: (color = 0xf6f4ef, o) =>
    phong('ceramic', 'fine', { color, specular: 0x666666, shininess: 45 }, o),

  // -- Organic / misc --------------------------------------------------------
  wood: (color = 0x8a5a2b, o) => lambert('wood', 'wood', { color }, o),
  darkWood: (o) => lambert('darkWood', 'wood', { color: 0x4e3220 }, o),
  fabric: (color = 0x6b7a8f, o) => lambert('fabric', 'blotch', { color }, o),
  skin: (color = 0xe8b89a, o) => lambert('skin', 'fine', { color, flatShading: false }, o),

  // -- Emissive / unlit -------------------------------------------------------
  // emissive keeps a real .emissive so the structural analyzer still knows
  // bulbs/screens are not mounts.
  emissive: (color = 0xfff2cc, intensity = 1, o) =>
    lambert('emissive', null, { color: 0x000000, emissive: color, emissiveIntensity: Math.min(intensity, 1.5) }, o),
  // Full-bright, ignores lighting entirely — skies, screens, stylized props.
  unlit: (color = 0xffffff, o = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...o });
    m.name = o.name || 'unlit';
    return m;
  },

  // -- Vertex colors / textures ----------------------------------------------
  // Pair with H.vertexPaint(mesh, fn) for per-vertex gradients — the classic
  // PS1 substitute for textures.
  vertexColor: (o) => lambert('vertexColor', 'fine', { color: 0xffffff, vertexColors: true }, o),
  // Convenience for textured surfaces: mats.textured(tex.wood(0x8a5a2b)).
  textured: (map, o = {}) => lambert('textured', null, { color: 0xffffff, map }, o),

  // -- Escape hatch: any MeshPhongMaterial parameters ------------------------
  custom: (params = {}) => {
    const m = new THREE.MeshPhongMaterial({ flatShading: true, ...params });
    m.name = params.name || 'custom';
    return m;
  },
};
