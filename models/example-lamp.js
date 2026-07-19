// Model: example-lamp — a classic articulated desk lamp.
// Demonstrates the AgentForge model API: named hierarchy, material presets,
// lathe/tube helpers, articulation via nested pivot groups, and centerGround.
import * as THREE from 'three';

export const meta = {
  name: 'example-lamp',
  description: 'Retro articulated desk lamp with a weighted base, two-segment arm and dome shade',
  units: 'meters',
  budget: 2500,
};

export function build({ THREE, mats, helpers: H }) {
  const deg = THREE.MathUtils.degToRad;

  const green = mats.paintedMetal(0x2e5540);
  const brass = mats.brass();
  const dark = mats.rubber(0x22252a);

  const root = H.group('DeskLamp');

  // --- Base: weighted dome via lathe -------------------------------------
  const base = H.group('Base');
  base.add(
    H.mesh('BaseDome', H.lathe([
      [0.085, 0.000],
      [0.085, 0.010],
      [0.080, 0.022],
      [0.062, 0.034],
      [0.038, 0.042],
      [0.020, 0.046],
      [0.014, 0.048],
      [0.000, 0.048],
    ], 16), green),
    H.mesh('BaseTrimRing', new THREE.TorusGeometry(0.082, 0.004, 6, 16), brass, {
      pos: [0, 0.006, 0], rot: [Math.PI / 2, 0, 0],
    }),
    H.mesh('BaseNeck', H.cylinder(0.011, 0.013, 0.035), green, { pos: [0, 0.046, 0] }),
  );
  root.add(base);

  // --- Lower arm: pivots at the top of the neck ---------------------------
  const ARM_LEN = 0.20;
  const lowerArm = H.group('LowerArm');
  lowerArm.position.set(0, 0.078, 0);
  lowerArm.rotation.z = deg(-24); // lean back
  lowerArm.add(
    H.mesh('LowerArmJoint', new THREE.SphereGeometry(0.016, 10, 7), brass),
    H.mesh('LowerArmKnob', H.cylinder(0.007, 0.007, 0.048), dark, {
      pos: [0, 0, -0.024], rot: [Math.PI / 2, 0, 0],
    }),
    H.mesh('LowerArmBar', H.cylinder(0.0085, 0.0095, ARM_LEN), green),
  );
  root.add(lowerArm);

  // --- Upper arm: pivots at the elbow -------------------------------------
  const upperArm = H.group('UpperArm');
  upperArm.position.set(0, ARM_LEN, 0);
  upperArm.rotation.z = deg(88); // fold forward
  upperArm.add(
    H.mesh('ElbowJoint', new THREE.SphereGeometry(0.015, 10, 7), brass),
    H.mesh('ElbowKnob', H.cylinder(0.007, 0.007, 0.046), dark, {
      pos: [0, 0, -0.023], rot: [Math.PI / 2, 0, 0],
    }),
    H.mesh('UpperArmBar', H.cylinder(0.008, 0.0085, ARM_LEN), green),
  );
  lowerArm.add(upperArm);

  // --- Head: shade + bulb, tilted down toward the desk ---------------------
  // Cumulative arm rotation is -24 + 88 = 64°; -94° here aims the shade
  // opening down-forward at the desk (~60° below horizontal).
  const head = H.group('Head');
  head.position.set(0, ARM_LEN, 0);
  head.rotation.z = deg(-94);

  // Dome shade: lathe around local Y, closed back at y=0, open rim at y=0.08.
  const shade = H.group('Shade');
  shade.rotation.z = deg(180); // open end points "down" along the head direction
  // Sunk 2mm through the shell back so socket<->shell overlap is structural;
  // r=9mm keeps the protruding stub fully inside the HeadJoint sphere
  // (sphere radial extent at the apex is ~9.8mm).
  const socket = H.mesh('BulbSocket', H.cylinder(0.009, 0.009, 0.024), dark, { pos: [0, -0.002, 0] });
  socket.userData.interior = true; // enclosed by the shade on purpose
  shade.add(
    H.mesh('ShadeShell', H.lathe([
      [0.000, 0.000],
      [0.028, 0.002],
      [0.052, 0.014],
      [0.066, 0.036],
      [0.071, 0.062],
      [0.072, 0.080],
    ], 16), mats.paintedMetal(0x2e5540, { side: THREE.DoubleSide })),
    H.mesh('ShadeRim', new THREE.TorusGeometry(0.0715, 0.0035, 6, 16), brass, {
      pos: [0, 0.080, 0], rot: [Math.PI / 2, 0, 0],
    }),
    H.mesh('Bulb', new THREE.SphereGeometry(0.026, 12, 8), mats.emissive(0xfff3d6, 4), {
      pos: [0, 0.032, 0],
    }),
    socket, // overlaps the shell back AND the bulb: solid structural chain
  );

  const headJoint = H.mesh('HeadJoint', new THREE.SphereGeometry(0.014, 10, 7), brass);
  head.add(headJoint, shade);
  // Weld the shade's closed back (its local origin) onto the joint sphere so
  // the arm grips the shade from behind — anchor points, not offset math.
  H.snap(shade, [0, 0, 0], headJoint, [0, 0.008, 0]);
  upperArm.add(head);

  // --- Cable: runs down the inside of the dome, then out the back ----------
  // A long thin part needs a proportionally long contact band, so the first
  // three points track just inside the dome wall (radius kept a few mm under
  // the lathe profile at each height) instead of poking through it at a
  // single point, which the contact analysis reads as grazing.
  root.add(
    H.mesh('Cable', H.tube([
      [0.018, 0.030, -0.059],
      [0.021, 0.024, -0.069],
      [0.023, 0.014, -0.075],
      [0.030, 0.006, -0.120],
      [0.010, 0.004, -0.190],
    ], 0.0035), dark),
  );

  // --- Switch button on the base -------------------------------------------
  root.add(
    H.mesh('SwitchButton', H.cylinder(0.009, 0.011, 0.014), brass, {
      pos: [0.052, 0.024, 0.045], rot: [deg(18), 0, deg(-14)],
    }),
  );

  return H.centerGround(root);
}
