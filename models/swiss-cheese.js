// Model: swiss-cheese — a wedge of Swiss Emmental cheese.
// Demonstrates CSG: the characteristic round "eyes" are spheres boolean-
// subtracted from a beveled extruded wedge, art-directed so craters open on
// the cut faces, the top and the rind.
import * as THREE from 'three';

export const meta = {
  name: 'swiss-cheese',
  description: 'Wedge of Swiss cheese (Emmental) with eyes carved by CSG',
  units: 'meters',
};

export function build({ THREE, mats, helpers: H }) {
  const R = 0.15;                       // wedge radius (tip to rind)
  const THETA = THREE.MathUtils.degToRad(52); // wedge angle
  const HGT = 0.082;                    // wedge height

  const cheeseMat = mats.custom({
    name: 'Emmental',
    color: 0xf3c76e,
    roughness: 0.58,
    metalness: 0,
    clearcoat: 0.15,
    clearcoatRoughness: 0.6,
    sheen: 0.4,
    sheenColor: 0xffedb8,
    sheenRoughness: 0.7,
  });

  // --- Wedge: CSG intersection of a cylinder and two boxes -----------------
  // ExtrudeGeometry caps (ear-clipped triangulation) are hostile topology for
  // CSG — sphere cuts through them corrupt normals. Building the wedge as
  // cylinder ∩ boxA ∩ boxB means every flat face of the result comes from a
  // clean 2-triangle box face and the curve from the cylinder wall; only
  // those surfaces survive, never the cylinder's triangle-fan caps.
  const deg = THREE.MathUtils.degToRad;
  // Oversized cylinder: its fan caps lie outside the boxes' y-range [0, HGT].
  const disc = H.mesh('Disc', new THREE.CylinderGeometry(R, R, 0.2, 96), cheeseMat, {
    pos: [0, HGT / 2, 0],
  });
  // keepA: half-space z < 0 (cut face A on the z=0 plane)
  const keepA = H.mesh('KeepA', new THREE.BoxGeometry(0.6, HGT, 0.3), cheeseMat, {
    pos: [0, HGT / 2, -0.15],
  });
  // keepB: half-space on the keep side of the 52° plane through the Y axis
  // (box +Z axis rotated to the plane normal, offset half a depth inward)
  const keepB = H.mesh('KeepB', new THREE.BoxGeometry(0.6, HGT, 0.3), cheeseMat, {
    pos: [0.118, HGT / 2, 0.0924],
    rot: [0, deg(-(180 - 52)), 0],
  });
  const wedge = H.intersect(disc, keepA, keepB);
  wedge.name = 'Wedge';

  // --- Eyes: spheres subtracted from the wedge -----------------------------
  // Cut face A lies on the z=0 plane; cut face B on the radial plane at THETA
  // (points (t cos52, y, -t sin52)); top at y=HGT; rind at radius R.
  const eyes = [
    // face A craters (z ~ 0)
    { p: [0.052, 0.050,  0.002], r: 0.016 },
    { p: [0.095, 0.026, -0.003], r: 0.011 },
    { p: [0.126, 0.058, -0.002], r: 0.009 },
    { p: [0.028, 0.022, -0.001], r: 0.008 },
    // face B craters (on the 52° radial plane)
    { p: [0.0369, 0.055, -0.0473], r: 0.014 },
    { p: [0.0616, 0.028, -0.0788], r: 0.010 },
    { p: [0.0813, 0.062, -0.1040], r: 0.008 },
    // top craters — centers nudged clearly off the y=HGT plane (coplanar CSG
    // breaks) and kept disjoint from each other (subtract() requires it)
    { p: [0.078, 0.086, -0.042], r: 0.015 },
    { p: [0.115, 0.0835, -0.028], r: 0.009 },
    { p: [0.045, 0.084, -0.062], r: 0.011 },
    // rind craters (curved face, radius R)
    { p: [0.141, 0.030, -0.0513], r: 0.013 },
    { p: [0.118, 0.058, -0.0923], r: 0.009 },
    // corner bite crossing top + face A (z nudged off the exact face plane —
    // coplanar CSG surfaces are an artifact risk)
    { p: [0.110, 0.082,  0.001], r: 0.012 },
  ];
  const cutters = eyes.map(({ p, r }, i) =>
    H.mesh(`Eye_${i}`, new THREE.SphereGeometry(r, 28, 20), cheeseMat, { pos: p })
  );

  const cheese = H.subtract(wedge, ...cutters);
  cheese.name = 'Wedge';

  const root = H.group('SwissCheese', cheese);
  return H.centerGround(root);
}
