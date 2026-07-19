// Geometry regression tests: no future build may ship a mesh with invalid
// indices, non-finite positions, degenerate triangles, vertices outside the
// expected bounds, or abnormally long faces.
//
//   node --test test/
//
// The CSG path is the one that historically produced broken topology, so it is
// exercised directly here (no browser needed — the helpers are pure three.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mesh, intersect, subtract, union, box, cylinder } from '../web/common/helpers.js';
import { validateGeometry, topologyReport } from '../web/common/meshclean.js';

const MAT = new THREE.MeshBasicMaterial();
const deg = THREE.MathUtils.degToRad;

/** The swiss-cheese wedge, rebuilt exactly as models/swiss-cheese.js builds it. */
function buildCheese() {
  const R = 0.15, HGT = 0.082;
  const disc = mesh('Disc', new THREE.CylinderGeometry(R, R, 0.2, 20), MAT, { pos: [0, HGT / 2, 0] });
  const keepA = mesh('KeepA', new THREE.BoxGeometry(0.6, HGT, 0.3), MAT, { pos: [0, HGT / 2, -0.15] });
  const keepB = mesh('KeepB', new THREE.BoxGeometry(0.6, HGT, 0.3), MAT, {
    pos: [0.118, HGT / 2, 0.0924], rot: [0, deg(-(180 - 52)), 0],
  });
  const wedge = intersect(disc, keepA, keepB);
  const eyes = [
    [0.052, 0.050, 0.002, 0.016], [0.095, 0.026, -0.003, 0.011],
    [0.126, 0.058, -0.002, 0.009], [0.028, 0.022, -0.001, 0.008],
    [0.0369, 0.055, -0.0473, 0.014], [0.0616, 0.028, -0.0788, 0.010],
    [0.0813, 0.062, -0.1040, 0.008], [0.078, 0.086, -0.042, 0.015],
    [0.115, 0.0835, -0.028, 0.009], [0.045, 0.084, -0.062, 0.011],
    [0.141, 0.030, -0.0513, 0.013], [0.118, 0.058, -0.0923, 0.009],
    [0.110, 0.082, 0.001, 0.012],
  ];
  const cutters = eyes.map(([x, y, z, r], i) =>
    mesh(`Eye_${i}`, new THREE.SphereGeometry(r, 10, 7), MAT, { pos: [x, y, z] }));
  return subtract(wedge, ...cutters);
}

test('CSG subtraction (swiss-cheese wedge) produces valid geometry', () => {
  const cheese = buildCheese();
  // The wedge lives in x 0..R, y 0..HGT, z -R..0 by construction; anything
  // outside that is a stray vertex, which is exactly the class of bug this
  // guards against.
  const res = validateGeometry(cheese.geometry, {
    label: 'SwissCheese',
    expectedBox: { min: [-0.001, -0.001, -0.16], max: [0.16, 0.083, 0.001] },
    longEdgeFactor: 40,
  });
  assert.equal(res.ok, true, res.errors.join('\n'));
  assert.equal(res.stats.degenerate, 0, 'no degenerate triangles');
  assert.ok(res.stats.vertexCount > 0 && res.stats.triangleCount > 0);
});

test('a single boolean yields a fully closed surface', () => {
  // One level of CSG repairs perfectly: this is the strict case.
  const R = 0.15, HGT = 0.082;
  const disc = mesh('Disc', new THREE.CylinderGeometry(R, R, 0.2, 20), MAT, { pos: [0, HGT / 2, 0] });
  const keepA = mesh('KeepA', new THREE.BoxGeometry(0.6, HGT, 0.3), MAT, { pos: [0, HGT / 2, -0.15] });
  const topo = topologyReport(intersect(disc, keepA).geometry);
  assert.equal(topo.boundary, 0, `boundary edges: ${topo.boundary}`);
  assert.equal(topo.nonManifold, 0, `non-manifold edges: ${topo.nonManifold}`);
  assert.equal(topo.watertight, true);
});

test('chained booleans stay essentially closed', () => {
  // The cheese chains 13 subtractions on top of an intersection. Measured
  // baseline after the repair pass: 25 boundary edges of 4,470 (0.56%) and 4
  // non-manifold, down from 1,665 boundary (44.7%) on the raw evaluator output.
  // These bounds are a regression guard around that measurement, not a claim
  // that chained booleans repair perfectly.
  const topo = topologyReport(buildCheese().geometry);
  assert.ok(topo.boundaryPct < 2,
    `boundary edges ${topo.boundary}/${topo.edges} = ${topo.boundaryPct.toFixed(2)}% (expected < 2%)`);
  assert.ok(topo.nonManifold <= 8, `non-manifold edges: ${topo.nonManifold} (expected <= 8)`);
});

test('CSG union (dresser runner frame) produces valid geometry', () => {
  const rail = mesh('Rail', box(0.714, 0.03, 0.45), MAT, { pos: [0, 0.375, 0.015] });
  const ribs = [-1, 1].map((sx) =>
    mesh('Guide', box(0.012, 0.245, 0.45), MAT, { pos: [sx * 0.351, 0.2525, 0.015] }));
  const frame = union(rail, ...ribs);
  const res = validateGeometry(frame.geometry, { label: 'RunnerFrame' });
  assert.equal(res.ok, true, res.errors.join('\n'));
  assert.equal(res.stats.degenerate, 0);
  assert.equal(topologyReport(frame.geometry).nonManifold, 0);
});

test('plain primitives stay watertight and valid', () => {
  for (const [name, geo] of [['box', box(0.2, 0.3, 0.4)], ['cylinder', cylinder(0.1, 0.1, 0.3)]]) {
    const res = validateGeometry(geo, { label: name });
    assert.equal(res.ok, true, res.errors.join('\n'));
  }
});

test('validateMesh catches the classic authoring bugs', async (t) => {
  const { validateMesh } = await import('../web/common/meshclean.js');

  await t.test('index past the end of the vertex array', () => {
    // The reported symptom of a missing baseVertexOffset when concatenating
    // sub-meshes: local indices appended as if they were global.
    const r = validateMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 5]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /outside \[0, 2\]/);
  });

  await t.test('non-finite position', () => {
    const r = validateMesh([0, 0, 0, NaN, 0, 0, 0, 1, 0], [0, 1, 2]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /non-finite position/);
  });

  await t.test('degenerate triangle (repeated index)', () => {
    const r = validateMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 1]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /degenerate triangle/);
  });

  await t.test('zero-area triangle from collinear points', () => {
    const r = validateMesh([0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 1, 2]);
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /degenerate triangle/);
  });

  await t.test('vertex outside the expected bounding box', () => {
    const r = validateMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 99, 0, 0, 0, 1, 0], [0, 1, 2, 3, 4, 5], {
      expectedBox: { min: [0, 0, 0], max: [1, 1, 1] },
    });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(' '), /outside the expected bounds/);
  });

  await t.test('abnormally long face', () => {
    const positions = [];
    const indices = [];
    for (let i = 0; i < 12; i++) {
      positions.push(i * 0.01, 0, 0, i * 0.01 + 0.01, 0, 0, i * 0.01, 0.01, 0);
      indices.push(i * 3, i * 3 + 1, i * 3 + 2);
    }
    const base = positions.length / 3;
    positions.push(0, 0, 0, 100, 0, 0, 0, 0.01, 0); // one face spanning the world
    indices.push(base, base + 1, base + 2);
    const r = validateMesh(positions, indices, { longEdgeFactor: 20 });
    // Long faces are reported as warnings: a big flat face is legal geometry,
    // so this must not fail an otherwise valid mesh.
    assert.equal(r.ok, true, r.errors.join('\n'));
    assert.equal(r.stats.longEdges, 1);
    assert.match(r.warnings.join(' '), /the median/);
  });

  await t.test('a clean triangle passes', () => {
    const r = validateMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2], { longEdgeFactor: 40 });
    assert.equal(r.ok, true, r.errors.join('\n'));
  });
});
