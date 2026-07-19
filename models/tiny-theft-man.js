import * as THREE from 'three';

// "Tiny Theft Man" — the male lead from the reference.png voxel key art
// (top-middle panel). Tan skin, short dark-brown hair, heavy brows, serious
// sideways glance, white ribbed tank top, chunky gold chain in a V, left
// fist raised beside the head gripping a dark pistol, muzzle up.
// Style: pure axis-aligned voxel art — every part is a box, big surfaces
// read as many voxels via a per-cell jittered grid texture (like the ref,
// where each voxel has its own slight tone).

export const meta = {
  name: 'tiny-theft-man',
  description: 'Voxel-art man from the Tiny Theft Auto key art: tank top, gold chain, pistol raised',
  units: 'meters',
  psx: {
    budget: 900,
    // Rendered clean/HD by request: no PSX post (no 320x240 upscale, no
    // dither, no vertex snap) — antialiased studio render instead.
    enabled: false,
  },
};

export function build({ THREE, mats, helpers: H, tex }) {
  // ---- per-voxel-cell jitter map (grayscale; multiplies under any color) ----
  // Each cell gets its own tone like the digitized voxels in the reference,
  // plus faint seam lines between cells.
  function voxelMap(cells, seed, jitter = 0.10, seam = 0.10) {
    let s = (seed * 16807) % 2147483647;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return tex.canvas(64, (ctx, w, h) => {
      const cw = w / cells;
      for (let y = 0; y < cells; y++) {
        for (let x = 0; x < cells; x++) {
          const v = Math.round(240 * (1 + (rnd() - 0.5) * 2 * jitter));
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(Math.floor(x * cw), Math.floor(y * cw), Math.ceil(cw) + 1, Math.ceil(cw) + 1);
        }
      }
      if (seam > 0) {
        ctx.fillStyle = `rgba(0,0,0,${seam})`;
        for (let i = 0; i <= cells; i++) {
          const p = Math.min(w - 1, Math.round(i * cw));
          ctx.fillRect(p, 0, 1, h);
          ctx.fillRect(0, p, w, 1);
        }
      }
    });
  }

  // ---- materials (colors sampled from the reference) -----------------------
  // Colors are pre-saturated to survive the HD studio's ACES tone mapping
  // (which desaturates) and still land on the reference's warm tan/gold.
  const skinMat   = mats.matte(0xe8873a, { name: 'Skin',       map: voxelMap(8, 11, 0.09, 0.07) });
  const hairMat   = mats.matte(0x46291a, { name: 'Hair',       map: voxelMap(7, 23, 0.16, 0.12) });
  const browMat   = mats.matte(0x1d0f08, { name: 'Brow',       map: null });
  const tankMat   = mats.matte(0xf2efe8, { name: 'TankTop',    map: voxelMap(8, 37, 0.06, 0.15) });
  const goldMat   = mats.gold({           name: 'GoldChain',   color: 0xe0a921, map: voxelMap(2, 41, 0.14, 0) });
  const gunMat    = mats.metal(0x363b45, 0.55, { name: 'GunMetal', map: voxelMap(6, 53, 0.12, 0.10) });
  const denimMat  = mats.fabric(0x3d5a94, { name: 'Denim',     map: voxelMap(8, 67, 0.11, 0.12) });
  const shoeMat   = mats.matte(0x34373d, { name: 'Shoe',       map: voxelMap(6, 71, 0.10, 0.10) });
  const soleMat   = mats.matte(0xe2ded2, { name: 'ShoeSole',   map: null });
  const eyeMat    = mats.matte(0xf5f0e6, { name: 'EyeWhite',   map: null });
  const pupilMat  = mats.matte(0x0d0a08, { name: 'Pupil',      map: null });
  const noseMat   = mats.matte(0xc07f42, { name: 'NoseShadow', map: null });
  const mouthMat  = mats.matte(0x64361f, { name: 'Mouth',      map: null });

  const root = H.group('TinyTheftMan');
  root.userData.units = 'meters';
  root.userData.up = '+y';
  root.userData.front = '+z';

  // ======================= HEAD (group at head center) =======================
  // Head box 0.34 x 0.40 x 0.34, center at y=1.35. Front face +Z.
  // He glances to HIS right (-X, viewer-left in front view) like the ref.
  const head = H.group('Head');
  head.position.set(0, 1.35, 0);

  head.add(H.mesh('HeadCore', H.box(0.34, 0.40, 0.34), skinMat));

  // hair: flat top slab + stepped crown cubes + fringe band with a lower dip
  // on his right temple + side patches + nape slab (matches ref silhouette)
  head.add(H.mesh('HairTop', H.box(0.37, 0.075, 0.37), hairMat, { pos: [0, 0.2125, -0.005] }));
  head.add(H.mesh('HairCrownA', H.box(0.09, 0.05, 0.10), hairMat, { pos: [-0.07, 0.26, -0.07] }));
  head.add(H.mesh('HairCrownB', H.box(0.07, 0.045, 0.08), hairMat, { pos: [0.08, 0.258, 0.02] }));
  head.add(H.mesh('HairFringe', H.box(0.34, 0.045, 0.05), hairMat, { pos: [0, 0.168, 0.155] }));
  head.add(H.mesh('HairFringeDip', H.box(0.10, 0.045, 0.05), hairMat, { pos: [-0.045, 0.128, 0.155] }));
  head.add(H.mesh('HairTempleLeft', H.box(0.05, 0.11, 0.17), hairMat, { pos: [0.165, 0.13, -0.055] }));
  head.add(H.mesh('HairTempleRight', H.box(0.05, 0.11, 0.17), hairMat, { pos: [-0.165, 0.13, -0.055] }));
  head.add(H.mesh('HairBack', H.box(0.36, 0.16, 0.05), hairMat, { pos: [0, 0.10, -0.165] }));

  // face — thick straight brows sitting low, wide sclera, pupils shifted to
  // his right (viewer-left), subtle darker nose block, small dark mouth
  head.add(H.mesh('BrowLeft', H.box(0.105, 0.04, 0.03), browMat, { pos: [0.072, 0.085, 0.165] }));
  head.add(H.mesh('BrowRight', H.box(0.105, 0.04, 0.03), browMat, { pos: [-0.072, 0.085, 0.165] }));
  head.add(H.mesh('EyeWhiteLeft', H.box(0.075, 0.05, 0.022), eyeMat, { pos: [0.072, 0.03, 0.165] }));
  head.add(H.mesh('EyeWhiteRight', H.box(0.075, 0.05, 0.022), eyeMat, { pos: [-0.072, 0.03, 0.165] }));
  head.add(H.mesh('PupilLeft', H.box(0.038, 0.05, 0.026), pupilMat, { pos: [0.056, 0.03, 0.167] }));
  head.add(H.mesh('PupilRight', H.box(0.038, 0.05, 0.026), pupilMat, { pos: [-0.088, 0.03, 0.167] }));
  head.add(H.mesh('Nose', H.box(0.06, 0.032, 0.022), noseMat, { pos: [-0.005, -0.045, 0.168] }));
  head.add(H.mesh('Mouth', H.box(0.085, 0.028, 0.02), mouthMat, { pos: [-0.005, -0.10, 0.167] }));

  head.add(H.mesh('EarLeft', H.box(0.04, 0.095, 0.075), skinMat, { pos: [0.18, 0.02, -0.01] }));
  head.add(H.mesh('EarRight', H.box(0.04, 0.095, 0.075), skinMat, { pos: [-0.18, 0.02, -0.01] }));
  head.add(H.mesh('EarNotchLeft', H.box(0.015, 0.045, 0.04), noseMat, { pos: [0.203, 0.02, -0.005] }));
  head.add(H.mesh('EarNotchRight', H.box(0.015, 0.045, 0.04), noseMat, { pos: [-0.203, 0.02, -0.005] }));

  root.add(head);

  // ======================= NECK + TORSO =====================================
  // Stacked joints overlap ~12-15mm so the big faces sit near-coplanar.
  root.add(H.mesh('Neck', H.box(0.14, 0.074, 0.14), skinMat, { pos: [0, 1.128, 0] }));

  const torsoG = H.group('TorsoGroup');
  torsoG.add(H.mesh('TankTorso', H.box(0.42, 0.44, 0.22), tankMat, { pos: [0, 0.82, 0] }));
  // upper chest skin showing above the tank scoop, straps over the shoulders
  torsoG.add(H.mesh('ChestSkin', H.box(0.30, 0.075, 0.215), skinMat, { pos: [0, 1.0655, 0] }));
  torsoG.add(H.mesh('StrapLeft', H.box(0.095, 0.05, 0.22), tankMat, { pos: [0.1425, 1.115, 0] }));
  torsoG.add(H.mesh('StrapRight', H.box(0.095, 0.05, 0.22), tankMat, { pos: [-0.1425, 1.115, 0] }));
  root.add(torsoG);

  // ======================= GOLD CHAIN (chunky V) ============================
  const chain = H.group('GoldChain');
  const links = [
    [0.12, 1.10, 0.055], [-0.12, 1.10, 0.055],
    [0.10, 1.064, 0.05], [-0.10, 1.064, 0.05],
    [0.08, 1.028, 0.055], [-0.08, 1.028, 0.055],
    [0.058, 0.994, 0.05], [-0.058, 0.994, 0.05],
    [0.034, 0.962, 0.055], [-0.034, 0.962, 0.055],
    [0, 0.934, 0.052],
  ];
  links.forEach(([x, y, s], i) => {
    chain.add(H.mesh(`ChainLink${i + 1}`, H.box(s, s, 0.048), goldMat, { pos: [x, y, 0.104] }));
  });
  root.add(chain);

  // ======================= LEFT ARM (his left, +X) — gun raised =============
  // Flex pose: deltoid -> bicep out along +X -> forearm straight up ->
  // fist at cheek height -> pistol, muzzle up. All axis-aligned.
  const armL = H.group('ArmLeft');
  armL.add(H.mesh('DeltoidLeft', H.box(0.13, 0.13, 0.13), skinMat, { pos: [0.265, 1.03, 0] }));
  armL.add(H.mesh('BicepLeft', H.box(0.14, 0.12, 0.12), skinMat, { pos: [0.388, 1.025, 0] }));
  armL.add(H.mesh('ForearmLeft', H.box(0.105, 0.24, 0.105), skinMat, { pos: [0.372, 1.197, 0] }));
  armL.add(H.mesh('FistLeft', H.box(0.115, 0.10, 0.12), skinMat, { pos: [0.372, 1.359, 0] }));
  // three chunky finger bars on the front of the fist, staggered in depth so
  // the knuckles read as separate voxel cubes like the reference
  const fingers = [
    [1.324, 0.058], [1.359, 0.072], [1.394, 0.064],
  ];
  fingers.forEach(([y, z], i) => {
    armL.add(H.mesh(`FingerLeft${i + 1}`, H.box(0.098, 0.03, 0.032), skinMat, { pos: [0.372, y, z] }));
  });
  armL.add(H.mesh('ThumbLeft', H.box(0.032, 0.06, 0.034), skinMat, { pos: [0.309, 1.386, 0.035] }));

  // ---- pistol: vertical slide raised above the fist, grip through the fist,
  // see-through trigger-guard hole between slide / grip / guard-front / fist
  // top (the fist closes the hole from below, like the ref), hammer step at
  // the breech, front-sight notch at the muzzle
  const pistol = H.group('Pistol');
  pistol.userData.kind = 'prop-pistol';
  pistol.add(H.mesh('GunSlide', H.box(0.07, 0.24, 0.048), gunMat, { pos: [0.368, 1.560, 0] }));
  pistol.add(H.mesh('GunSight', H.box(0.022, 0.024, 0.034), gunMat, { pos: [0.345, 1.686, 0] }));
  pistol.add(H.mesh('GunGrip', H.box(0.048, 0.162, 0.06), gunMat, { pos: [0.372, 1.367, 0] }));
  pistol.add(H.mesh('GunGuardFront', H.box(0.018, 0.043, 0.04), gunMat, { pos: [0.314, 1.4245, 0] }));
  pistol.add(H.mesh('GunHammer', H.box(0.026, 0.026, 0.034), gunMat, { pos: [0.408, 1.451, 0] }));
  pistol.add(H.marker('MuzzleTip', { pos: [0.368, 1.680, 0], data: { kind: 'muzzle' } }));
  armL.add(pistol);
  root.add(armL);

  // ======================= RIGHT ARM (his right, -X) — hanging ==============
  const armR = H.group('ArmRight');
  armR.add(H.mesh('DeltoidRight', H.box(0.13, 0.13, 0.13), skinMat, { pos: [-0.265, 1.03, 0] }));
  armR.add(H.mesh('ArmRightUpper', H.box(0.105, 0.20, 0.105), skinMat, { pos: [-0.265, 0.877, 0] }));
  armR.add(H.mesh('ArmRightLower', H.box(0.095, 0.20, 0.095), skinMat, { pos: [-0.265, 0.689, 0.004] }));
  armR.add(H.mesh('HandRight', H.box(0.10, 0.09, 0.10), skinMat, { pos: [-0.265, 0.556, 0.008] }));
  root.add(armR);

  // ======================= LEGS (extrapolated: jeans + sneakers) ============
  // stacked joints: each top face sits 8mm above the face it mounts under,
  // so the big parallel faces register as real overlap (protocol rule 6)
  const legs = H.group('Legs');
  legs.add(H.mesh('Hips', H.box(0.38, 0.16, 0.20), denimMat, { pos: [0, 0.528, 0] }));
  legs.add(H.mesh('LegLeft', H.box(0.155, 0.37, 0.175), denimMat, { pos: [0.10, 0.271, 0] }));
  legs.add(H.mesh('LegRight', H.box(0.155, 0.37, 0.175), denimMat, { pos: [-0.10, 0.271, 0] }));
  legs.add(H.mesh('ShoeLeft', H.box(0.165, 0.075, 0.25), shoeMat, { pos: [0.10, 0.0565, 0.03] }));
  legs.add(H.mesh('ShoeRight', H.box(0.165, 0.075, 0.25), shoeMat, { pos: [-0.10, 0.0565, 0.03] }));
  legs.add(H.mesh('SoleLeft', H.box(0.17, 0.03, 0.255), soleMat, { pos: [0.10, 0.012, 0.03] }));
  legs.add(H.mesh('SoleRight', H.box(0.17, 0.03, 0.255), soleMat, { pos: [-0.10, 0.012, 0.03] }));
  root.add(legs);

  return H.centerGround(root);
}
