// Material preset library for low-poly work. Every factory returns a FRESH
// MeshStandardMaterial (or MeshPhysicalMaterial where a clearcoat/transmission
// lobe is needed), so models are physically lit by the studio environment and
// export straight into glTF's metallic-roughness model with no translation.
//
// FLAT SHADING IS THE DEFAULT. Low-poly form reads through its facets: each
// triangle should catch its own value. Pass { flatShading: false } for smooth
// normals on genuinely organic shapes (skin, cloth folds, a curved handle).
//
// Color is authored in sRGB the way you would pick it in an image editor.
// Note the studio applies ACES tone mapping, which desaturates roughly 15% —
// pre-saturate a touch if you need to land on an exact tone.
//
// All presets accept a color (hex number or CSS string) and an overrides
// object merged into the material parameters.
import * as THREE from 'three';

function standard(name, params, overrides = {}) {
  const m = new THREE.MeshStandardMaterial({
    flatShading: true,
    ...params,
    ...overrides,
  });
  m.name = overrides.name || name;
  return m;
}

function physical(name, params, overrides = {}) {
  const m = new THREE.MeshPhysicalMaterial({
    flatShading: true,
    ...params,
    ...overrides,
  });
  m.name = overrides.name || name;
  return m;
}

export const mats = {
  // -- Plastics / matte surfaces ---------------------------------------------
  plastic: (color = 0x4a90d9, o) =>
    standard('plastic', { color, roughness: 0.55, metalness: 0 }, o),
  glossyPlastic: (color = 0xd94a4a, o) =>
    physical('glossyPlastic', {
      color, roughness: 0.28, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2,
    }, o),
  matte: (color = 0x9aa0a6, o) =>
    standard('matte', { color, roughness: 0.92, metalness: 0 }, o),
  rubber: (color = 0x2b2b2e, o) =>
    standard('rubber', { color, roughness: 0.98, metalness: 0 }, o),

  // -- Metals -----------------------------------------------------------------
  metal: (color = 0xb8bcc4, roughness = 0.35, o) =>
    standard('metal', { color, roughness, metalness: 1 }, o),
  chrome: (o) =>
    standard('chrome', { color: 0xd8dce4, roughness: 0.06, metalness: 1 }, o),
  brushedMetal: (color = 0xa8acb4, o) =>
    standard('brushedMetal', { color, roughness: 0.52, metalness: 1 }, o),
  gold: (o) => standard('gold', { color: 0xd9a441, roughness: 0.22, metalness: 1 }, o),
  brass: (o) => standard('brass', { color: 0xc9a227, roughness: 0.32, metalness: 1 }, o),
  copper: (o) => standard('copper', { color: 0xc06542, roughness: 0.3, metalness: 1 }, o),
  paintedMetal: (color = 0x33691e, o) =>
    physical('paintedMetal', {
      color, roughness: 0.42, metalness: 0.1, clearcoat: 0.35, clearcoatRoughness: 0.35,
    }, o),

  // -- Glass / ceramics --------------------------------------------------------
  // Alpha-blended rather than transmissive: cheaper, renders predictably in
  // ortho views, and counts as non-structural in the assembly analysis.
  glass: (color = 0xa8d8e8, o) =>
    physical('glass', {
      color, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.35,
      side: THREE.DoubleSide, depthWrite: false,
    }, o),
  frostedGlass: (color = 0xcfdce4, o) =>
    physical('frostedGlass', {
      color, roughness: 0.6, metalness: 0, transparent: true, opacity: 0.6,
      side: THREE.DoubleSide, depthWrite: false,
    }, o),
  ceramic: (color = 0xf6f4ef, o) =>
    physical('ceramic', {
      color, roughness: 0.35, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25,
    }, o),

  // -- Organic / misc ----------------------------------------------------------
  wood: (color = 0x8a5a2b, o) => standard('wood', { color, roughness: 0.72, metalness: 0 }, o),
  darkWood: (o) => standard('darkWood', { color: 0x4e3220, roughness: 0.68, metalness: 0 }, o),
  fabric: (color = 0x6b7a8f, o) => standard('fabric', { color, roughness: 0.95, metalness: 0 }, o),
  // Organic surfaces are the exception to flat shading.
  skin: (color = 0xe8b89a, o) =>
    standard('skin', { color, roughness: 0.68, metalness: 0, flatShading: false }, o),

  // -- Emissive / unlit ---------------------------------------------------------
  // emissive keeps a real .emissive so the structural analyzer still knows
  // bulbs/screens are not mounts.
  emissive: (color = 0xfff2cc, intensity = 1, o) =>
    standard('emissive', {
      color: 0x000000, emissive: color, emissiveIntensity: intensity,
      roughness: 1, metalness: 0,
    }, o),
  // Full-bright, ignores lighting entirely — screens, signs, decals.
  unlit: (color = 0xffffff, o = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...o });
    m.name = o.name || 'unlit';
    return m;
  },

  // -- Vertex colors / textures --------------------------------------------------
  // Pair with H.vertexPaint(mesh, fn) for per-vertex gradients and fake AO —
  // the cheapest way to add tonal variation to a low-poly surface.
  vertexColor: (o) =>
    standard('vertexColor', { color: 0xffffff, roughness: 0.7, metalness: 0, vertexColors: true }, o),
  // Convenience for textured surfaces: mats.textured(tex.wood(0x8a5a2b)).
  textured: (map, o = {}) =>
    standard('textured', { color: 0xffffff, map, roughness: 0.7, metalness: 0 }, o),

  // -- Escape hatch: any MeshPhysicalMaterial parameters -------------------------
  custom: (params = {}) => {
    const m = new THREE.MeshPhysicalMaterial({ flatShading: true, ...params });
    m.name = params.name || 'custom';
    return m;
  },
};
