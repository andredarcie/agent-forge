// Mesh validation and repair for boolean (CSG) output.
//
// three-bvh-csg emits a triangle SOUP: every triangle carries its own three
// vertices, and where a cut edge crosses an existing face it inserts vertices
// that lie in the middle of a neighbouring triangle's edge without splitting
// that triangle. Those are T-junctions. The result renders acceptably in a
// large antialiased frame but is not a closed surface: ~45% of its edges are
// used by a single triangle. That breaks subdivision, normal recalculation,
// further booleans and collider generation downstream, and at low resolution
// the cracks show as pinholes.
//
// cleanBooleanResult() fixes the topology instead of hiding it:
//   1. weld coincident vertices so shared corners become shared indices
//   2. split every edge that has vertices sitting on its interior, which is
//      what actually removes the T-junctions
//   3. drop zero-area triangles produced by the split
//   4. recompute normals on the repaired mesh
import * as THREE from 'three';

/**
 * Weld vertices closer than `tol` into one shared index. Returns indexed
 * geometry. Non-position attributes (uv, color, ...) are carried over from the
 * first vertex of each welded cluster — dropping them breaks chained booleans,
 * because the evaluator requires both operands to expose the same attributes.
 */
export function weldByPosition(geo, tol = 1e-5) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const p = src.attributes.position.array;
  const n = p.length / 3;
  const buckets = new Map();
  const rep = new Int32Array(n);
  const uniq = [];
  const q = (v) => Math.round(v / tol);

  // every attribute except position/normal (normal is recomputed after repair)
  const carried = Object.keys(src.attributes)
    .filter((k) => k !== 'position' && k !== 'normal')
    .map((k) => ({ name: k, src: src.attributes[k], itemSize: src.attributes[k].itemSize, out: [] }));

  for (let i = 0; i < n; i++) {
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    let r;
    // Probe the 27 neighbouring buckets: a pure hash would split two vertices
    // that are within tol but land either side of a bucket boundary.
    outer:
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cand = buckets.get(`${q(x) + dx},${q(y) + dy},${q(z) + dz}`);
          if (cand === undefined) continue;
          const d = Math.hypot(x - uniq[cand * 3], y - uniq[cand * 3 + 1], z - uniq[cand * 3 + 2]);
          if (d <= tol) { r = cand; break outer; }
        }
      }
    }
    if (r === undefined) {
      r = uniq.length / 3;
      uniq.push(x, y, z);
      buckets.set(`${q(x)},${q(y)},${q(z)}`, r);
      for (const a of carried) {
        for (let c = 0; c < a.itemSize; c++) a.out.push(a.src.array[i * a.itemSize + c]);
      }
    }
    rep[i] = r;
  }

  const idx = [];
  for (let t = 0; t < n / 3; t++) {
    const a = rep[t * 3], b = rep[t * 3 + 1], c = rep[t * 3 + 2];
    if (a === b || b === c || a === c) continue; // collapsed by the weld
    idx.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(uniq, 3));
  for (const a of carried) {
    out.setAttribute(a.name, new THREE.Float32BufferAttribute(a.out, a.itemSize));
  }
  out.setIndex(idx);
  return out;
}

/**
 * Split every edge that has welded vertices lying on its interior. This is the
 * step that removes T-junctions: the long edge is replaced by a chain through
 * the points its neighbours already use, so both sides share the same edges.
 */
export function repairTJunctions(geo, tol = 1e-6, { cell = 0.005, maxPasses = 6 } = {}) {
  const pos = geo.attributes.position.array;
  let idx = Array.from(geo.index.array);
  const nv = pos.length / 3;
  const P = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];

  const grid = new Map();
  for (let i = 0; i < nv; i++) {
    const [x, y, z] = P(i);
    const k = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  // Vertices strictly inside segment (a,b), ordered along it.
  function onSegment(a, b) {
    const A = P(a), B = P(b);
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
    if (L2 === 0) return [];
    // Walk ALONG the segment sampling cells. Scanning the segment's 3D bounding
    // box instead is catastrophic for a long edge with a small cell size.
    const steps = Math.ceil(Math.sqrt(L2) / cell) + 1;
    const seen = new Set();
    const cand = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const bx = Math.floor((A[0] + ab[0] * t) / cell);
      const by = Math.floor((A[1] + ab[1] * t) / cell);
      const bz = Math.floor((A[2] + ab[2] * t) / cell);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const k = `${bx + dx},${by + dy},${bz + dz}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const b2 = grid.get(k);
            if (b2) cand.push(...b2);
          }
        }
      }
    }
    const hits = [];
    for (const v of cand) {
      if (v === a || v === b) continue;
      const V = P(v);
      const t = ((V[0] - A[0]) * ab[0] + (V[1] - A[1]) * ab[1] + (V[2] - A[2]) * ab[2]) / L2;
      if (t <= 1e-7 || t >= 1 - 1e-7) continue;
      const px = A[0] + ab[0] * t, py = A[1] + ab[1] * t, pz = A[2] + ab[2] * t;
      if (Math.hypot(V[0] - px, V[1] - py, V[2] - pz) <= tol) hits.push([t, v]);
    }
    hits.sort((x, y) => x[0] - y[0]);
    // de-duplicate vertices that welded to the same index
    return hits.map((h) => h[1]).filter((v, i, arr) => arr.indexOf(v) === i);
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const next = [];
    let splits = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const tri = [idx[t], idx[t + 1], idx[t + 2]];
      let best = -1, bestPts = [];
      for (let e = 0; e < 3; e++) {
        const pts = onSegment(tri[e], tri[(e + 1) % 3]);
        if (pts.length > bestPts.length) { best = e; bestPts = pts; }
      }
      if (!bestPts.length) { next.push(...tri); continue; }
      splits++;
      const a = tri[best], b = tri[(best + 1) % 3], c = tri[(best + 2) % 3];
      const chain = [a, ...bestPts, b];
      for (let k = 0; k < chain.length - 1; k++) next.push(chain[k], chain[k + 1], c);
    }
    idx = next;
    if (!splits) break;
  }

  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr.clone());
  out.setIndex(idx);
  return out;
}

/** Remove triangles with repeated indices or effectively zero area. */
export function dropDegenerates(geo, minArea = 1e-12) {
  const p = geo.attributes.position.array;
  const idx = geo.index.array;
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (a === b || b === c || a === c) continue;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const ux = p[b * 3] - ax, uy = p[b * 3 + 1] - ay, uz = p[b * 3 + 2] - az;
    const vx = p[c * 3] - ax, vy = p[c * 3 + 1] - ay, vz = p[c * 3 + 2] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (0.5 * Math.hypot(cx, cy, cz) < minArea) continue;
    out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) g.setAttribute(name, attr.clone());
  g.setIndex(out);
  return g;
}

/** Full repair pipeline for a boolean result. Returns a new BufferGeometry. */
export function cleanBooleanResult(geo, { weldTol = 1e-5, tjTol = 1e-6 } = {}) {
  let g = weldByPosition(geo, weldTol);
  g = repairTJunctions(g, tjTol);
  g = dropDegenerates(g);
  g.computeVertexNormals();
  g.name = geo.name || '';
  return g;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate raw mesh arrays. Returns { ok, errors[], stats }. Set `throwOnError`
 * to raise instead. Every message names the triangle, its indices and the
 * offending coordinates so the defect is locatable without a viewer.
 */
export function validateMesh(positions, indices, {
  label = 'mesh',
  expectedBox = null,      // { min:[x,y,z], max:[x,y,z] } — vertices must fall inside (+ margin)
  boxMargin = 1e-3,
  longEdgeFactor = 0,      // >0: flag edges longer than factor x the median edge
  minArea = 1e-12,
  maxReported = 12,
  throwOnError = false,
} = {}) {
  const errors = [];
  const warnings = [];
  const push = (m) => { if (errors.length < maxReported) errors.push(`[${label}] ${m}`); };
  // A long edge is not by itself invalid — a big flat face legitimately spans
  // the model — so it is reported as a warning, not an error.
  const warn = (m) => { if (warnings.length < maxReported) warnings.push(`[${label}] ${m}`); };

  if (positions.length % 3 !== 0) push(`positions length ${positions.length} is not divisible by 3.`);
  if (indices && indices.length % 3 !== 0) push(`indices length ${indices.length} is not divisible by 3.`);

  const vertexCount = Math.floor(positions.length / 3);

  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      push(`non-finite position at component ${i} (vertex ${Math.floor(i / 3)}, axis ${'xyz'[i % 3]}): ${positions[i]}`);
    }
  }

  const idx = indices || Array.from({ length: vertexCount }, (_, i) => i);
  for (let i = 0; i < idx.length; i++) {
    const v = idx[i];
    if (!Number.isInteger(v) || v < 0 || v >= vertexCount) {
      push(`index ${i} (triangle ${Math.floor(i / 3)}) is ${v}, outside [0, ${vertexCount - 1}].`);
    }
  }

  if (expectedBox) {
    for (let v = 0; v < vertexCount; v++) {
      const P = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
      for (let c = 0; c < 3; c++) {
        if (P[c] < expectedBox.min[c] - boxMargin || P[c] > expectedBox.max[c] + boxMargin) {
          push(`vertex ${v} at (${P.map((n) => n.toFixed(5)).join(', ')}) lies outside the expected bounds ` +
            `${JSON.stringify(expectedBox.min)}..${JSON.stringify(expectedBox.max)} on axis ${'xyz'[c]}.`);
          break;
        }
      }
    }
  }

  const triCount = Math.floor(idx.length / 3);
  const edgeLengths = [];
  const degenerate = [];
  const P = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];

  for (let t = 0; t < triCount; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue; // already reported
    if (a === b || b === c || a === c) {
      degenerate.push({ t, a, b, c, why: 'repeated index' });
      continue;
    }
    const A = P(a), B = P(b), C = P(c);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const area = 0.5 * Math.hypot(cr[0], cr[1], cr[2]);
    if (area < minArea) degenerate.push({ t, a, b, c, why: `area ${area.toExponential(2)}` });
    const d = (X, Y) => Math.hypot(X[0] - Y[0], X[1] - Y[1], X[2] - Y[2]);
    edgeLengths.push(d(A, B), d(B, C), d(C, A));
  }

  for (const g of degenerate) {
    const co = [g.a, g.b, g.c].map((i) => `(${P(i).map((n) => n.toFixed(5)).join(', ')})`).join(' ');
    push(`degenerate triangle ${g.t} [${g.a}, ${g.b}, ${g.c}] — ${g.why}. Coordinates: ${co}`);
  }

  let longEdges = 0;
  let median = 0;
  if (edgeLengths.length) {
    const sorted = [...edgeLengths].sort((x, y) => x - y);
    median = sorted[Math.floor(sorted.length / 2)];
    if (longEdgeFactor > 0 && median > 0) {
      const limit = median * longEdgeFactor;
      for (let t = 0; t < triCount; t++) {
        const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
        if (a >= vertexCount || b >= vertexCount || c >= vertexCount) continue;
        const A = P(a), B = P(b), C = P(c);
        const d = (X, Y) => Math.hypot(X[0] - Y[0], X[1] - Y[1], X[2] - Y[2]);
        const longest = Math.max(d(A, B), d(B, C), d(C, A));
        if (longest > limit) {
          longEdges++;
          warn(`triangle ${t} [${a}, ${b}, ${c}] has edge ${longest.toFixed(5)} > ${longEdgeFactor}x the median ` +
            `${median.toFixed(5)}. Coordinates: (${A.map((n) => n.toFixed(4)).join(', ')}) ` +
            `(${B.map((n) => n.toFixed(4)).join(', ')}) (${C.map((n) => n.toFixed(4)).join(', ')})`);
        }
      }
    }
  }

  const stats = {
    vertexCount, triangleCount: triCount,
    degenerate: degenerate.length, longEdges, medianEdge: median,
  };
  const ok = errors.length === 0;
  if (!ok && throwOnError) throw new Error(`validateMesh failed:\n  ${errors.join('\n  ')}`);
  return { ok, errors, warnings, stats };
}

/** Convenience wrapper for a THREE.BufferGeometry. */
export function validateGeometry(geo, opts = {}) {
  const pos = geo.attributes.position ? geo.attributes.position.array : [];
  const idx = geo.index ? geo.index.array : null;
  return validateMesh(pos, idx, opts);
}

/** Boundary/non-manifold audit — how close the surface is to being closed. */
export function topologyReport(geo) {
  const idx = geo.index ? Array.from(geo.index.array)
    : Array.from({ length: geo.attributes.position.count }, (_, i) => i);
  const edges = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = x < y ? `${x}_${y}` : `${y}_${x}`;
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  let boundary = 0, nonManifold = 0;
  for (const n of edges.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  return {
    edges: edges.size,
    boundary,
    nonManifold,
    boundaryPct: edges.size ? (100 * boundary) / edges.size : 0,
    watertight: boundary === 0 && nonManifold === 0,
  };
}
