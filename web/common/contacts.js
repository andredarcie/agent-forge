// Structural contact analysis: measures real surface-to-surface distances
// between every nearby pair of meshes (BVH-accelerated), builds a contact
// graph, and flags structural defects the bounding-box analyzer cannot see:
//   - floating assemblies (parts connected to nothing)
//   - tenuous attachments (assemblies held only by a grazing contact)
// This exists because a model can be geometrically valid yet structurally
// wrong (e.g. a lamp shade "held" by its rim touching the arm).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

const MAX_MESHES = 120;
const MAX_TRIS = 400000;
const SAMPLES_PER_MESH = 120;

function pathOf(o, root) {
  const parts = [];
  let n = o;
  while (n && n !== root) {
    parts.unshift(n.name || `<unnamed ${n.type}>`);
    n = n.parent;
  }
  return parts.join('/');
}

export function analyzeContacts(root, { toleranceFactor = 0.006 } = {}) {
  root.updateMatrixWorld(true);

  const meshes = [];
  let totalTris = 0;
  root.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      meshes.push(o);
      totalTris += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    }
  });

  if (meshes.length < 2) return { skipped: 'single mesh', contacts: [], components: [[...meshes.map((m) => pathOf(m, root))]], issues: [] };
  if (meshes.length > MAX_MESHES || totalTris > MAX_TRIS) {
    return {
      skipped: `model too large for contact analysis (${meshes.length} meshes, ${totalTris} tris)`,
      contacts: [], components: [], issues: [{ level: 'info', message: 'Contact analysis skipped: model too large.' }],
    };
  }

  const rootBox = new THREE.Box3().setFromObject(root);
  const diag = rootBox.getSize(new THREE.Vector3()).length();
  const tol = Math.max(0.0008, diag * toleranceFactor);

  // Per-mesh cached data: world AABB, BVH, world-space surface samples.
  const bvhCache = new Map(); // geometry.uuid -> MeshBVH
  const data = meshes.map((mesh) => {
    const box = new THREE.Box3().setFromObject(mesh);
    if (!bvhCache.has(mesh.geometry.uuid)) {
      bvhCache.set(mesh.geometry.uuid, new MeshBVH(mesh.geometry));
    }
    const sampler = new MeshSurfaceSampler(mesh).build();
    const samples = [];
    const p = new THREE.Vector3();
    for (let i = 0; i < SAMPLES_PER_MESH; i++) {
      sampler.sample(p);
      samples.push(p.clone().applyMatrix4(mesh.matrixWorld));
    }
    return { mesh, box, bvh: bvhCache.get(mesh.geometry.uuid), samples, path: pathOf(mesh, root) };
  });

  // Minimum world distance from a set of world points to a mesh surface.
  function pointsToMesh(points, target) {
    const inv = new THREE.Matrix4().copy(target.mesh.matrixWorld).invert();
    const local = new THREE.Vector3();
    const hit = {};
    const world = new THREE.Vector3();
    let min = Infinity;
    let within = 0;
    for (const wp of points) {
      local.copy(wp).applyMatrix4(inv);
      target.bvh.closestPointToPoint(local, hit);
      world.copy(hit.point).applyMatrix4(target.mesh.matrixWorld);
      const d = world.distanceTo(wp);
      if (d < min) min = d;
      if (d <= tol) within++;
    }
    return { min, within };
  }

  // A mesh is "structural" if it can plausibly bear an attachment. Emissive
  // parts (bulbs, screens) and transmissive parts (glass) are not mounts.
  function isStructural(mesh) {
    const mList = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mList) {
      if (!m) continue;
      if (m.emissiveIntensity > 0.5 && m.emissive && m.emissive.getHex() !== 0) return false;
      if (m.transmission > 0.5) return false;
      // PSX glass: plain alpha-blended transparency instead of transmission
      if (m.transparent && m.opacity < 0.7) return false;
    }
    return true;
  }
  for (const d of data) d.structural = isStructural(d.mesh);

  // Pairwise contact test, prefiltered by expanded AABB overlap.
  const contacts = [];
  const pairs = [];
  const adjacency = new Map(data.map((d) => [d, []]));
  for (let i = 0; i < data.length; i++) {
    for (let j = i + 1; j < data.length; j++) {
      const A = data[i], B = data[j];
      const ea = A.box.clone().expandByScalar(tol);
      if (!ea.intersectsBox(B.box)) continue;
      const ab = pointsToMesh(A.samples, B);
      const ba = pointsToMesh(B.samples, A);
      const gap = Math.min(ab.min, ba.min);
      if (gap <= tol) {
        // fraction of sampled surface points within tolerance — low values
        // mean a grazing touch, high values mean real overlap/embedding
        const strength = Math.round(Math.max(ab.within / A.samples.length, ba.within / B.samples.length) * 1000) / 1000;
        contacts.push({
          a: A.path, b: B.path,
          gap: Math.round(gap * 100000) / 100000,
          strength,
          structural: A.structural && B.structural,
        });
        pairs.push({ A, B, strength });
        adjacency.get(A).push({ other: B, strength });
        adjacency.get(B).push({ other: A, strength });
      }
    }
  }

  // Connected components via union-find. Computed twice:
  //  - full graph (all contacts)      → floating-assembly detection
  //  - strong graph (real overlaps)   → tenuous-attachment detection
  function componentsOf(edgeFilter) {
    const parent = new Map(data.map((d) => [d, d]));
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const d of data) {
      for (const link of adjacency.get(d)) {
        if (!edgeFilter(link, d)) continue;
        const ra = find(d), rb = find(link.other);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
    const compMap = new Map();
    for (const d of data) {
      const r = find(d);
      if (!compMap.has(r)) compMap.set(r, []);
      compMap.get(r).push(d);
    }
    return [...compMap.values()].sort((x, y) => y.length - x.length);
  }

  // Below this contact strength a touch is "grazing". Calibrated against real
  // models: intended attachments overlap and score >= ~0.13; accidental
  // grazes score < ~0.06.
  const GRAZE = 0.1;
  const components = componentsOf(() => true);
  const strongComponents = componentsOf((l) => l.strength >= GRAZE);

  const issues = [];

  // 1. Floating assemblies: everything should connect to the main body.
  for (const comp of components.slice(1)) {
    const names = comp.map((d) => d.path);
    // nearest gap from this component to the main component, for the report
    let nearest = { gap: Infinity, a: '', b: '' };
    for (const d of comp) {
      for (const m of components[0]) {
        const ab = pointsToMesh(d.samples, m);
        if (ab.min < nearest.gap) nearest = { gap: ab.min, a: d.path, b: m.path };
      }
    }
    issues.push({
      level: 'error',
      message: `FLOATING ASSEMBLY: [${names.join(', ')}] touches nothing else in the model. ` +
        `Nearest gap: ${(nearest.gap * 1000).toFixed(1)}mm between "${nearest.a}" and "${nearest.b}". ` +
        `Parts must physically overlap or touch what they attach to.`,
      parts: [comp[0].mesh.name || names[0]],
    });
  }

  // 2. Tenuous attachments: a sub-assembly connected to the main body ONLY
  // through grazing contact(s) is almost always a modeling error — intended
  // attachments overlap geometry and produce strong contacts.
  const mainStrong = new Set(strongComponents[0] || []);
  for (const comp of strongComponents.slice(1)) {
    // Was this sub-assembly attached to the main body in the full graph?
    const inMainFull = components[0].includes(comp[0]);
    if (!inMainFull) continue; // already reported as floating
    const names = comp.map((d) => d.path);
    const bridges = [];
    for (const d of comp) {
      for (const link of adjacency.get(d)) {
        if (link.strength < GRAZE && mainStrong.has(link.other)) {
          bridges.push(`"${d.path}" <-> "${link.other.path}" (strength ${link.strength.toFixed(3)})`);
        }
      }
    }
    issues.push({
      level: 'error',
      message: `TENUOUS ATTACHMENT: assembly [${names.join(', ')}] is held to the rest of the model only by ` +
        `grazing contact: ${bridges.slice(0, 3).join('; ') || '(indirect)'}. A real attachment must overlap — ` +
        `reposition the assembly or add a bracket/strut so the mounting parts interpenetrate.`,
      parts: [comp[0].mesh.name || names[0]],
    });
  }

  // 3. Non-structural support: emissive/glass parts (bulbs, screens, panes)
  // must not be the load path that holds an assembly together. Recompute the
  // strong graph using only structural-to-structural edges; anything that
  // becomes disconnected was being carried by a bulb or a pane of glass.
  const structuralComponents = componentsOf(
    (l, d) => l.strength >= GRAZE && d.structural && l.other.structural
  );
  for (const comp of structuralComponents.slice(1)) {
    if (!comp.some((d) => d.structural)) continue; // a lone bulb/pane is fine
    if (!components[0].includes(comp[0])) continue; // already reported as floating
    // The strong links that were carrying this assembly: edges with a
    // non-structural endpoint. If there are none, the separation came from
    // grazing-only contacts and the tenuous-attachment check covers it.
    const carriers = new Set();
    for (const d of comp) {
      for (const link of adjacency.get(d)) {
        if (link.strength >= GRAZE && !comp.includes(link.other) && (!d.structural || !link.other.structural)) {
          carriers.add(!link.other.structural ? link.other.path : d.path);
        }
      }
    }
    if (!carriers.size) continue;
    const names = comp.map((d) => d.path);
    issues.push({
      level: 'error',
      message: `NON-STRUCTURAL SUPPORT: assembly [${names.join(', ')}] is attached to the model only through ` +
        `${[...carriers].map((c) => `"${c}"`).join(', ')} — an emissive/glass part cannot be a mount. ` +
        `Attach the assembly through solid parts (make them overlap).`,
      parts: [comp[0].mesh.name || names[0]],
    });
  }

  // 4. Assembly interfaces: for every named group, list the contacts that
  // cross its boundary — this is where sub-assemblies mount to the rest of
  // the model, and exactly where attachment mistakes live. Pure data: agents
  // should read this to verify each mount makes physical sense.
  const interfaces = [];
  root.traverse((g) => {
    if (!g.isGroup || !g.name || g === root) return;
    const inside = new Set();
    g.traverse((o) => { if (o.isMesh) inside.add(o); });
    if (!inside.size) return;
    const links = [];
    for (const p of pairs) {
      const aIn = inside.has(p.A.mesh), bIn = inside.has(p.B.mesh);
      if (aIn === bIn) continue;
      const inner = aIn ? p.A : p.B;
      const outer = aIn ? p.B : p.A;
      links.push({
        inside: inner.path, outside: outer.path,
        strength: p.strength,
        grazing: p.strength < GRAZE,
        viaNonStructural: !inner.structural || !outer.structural,
      });
    }
    interfaces.push({ group: pathOf(g, root), mountedBy: links.sort((x, y) => y.strength - x.strength) });
  });

  return {
    tolerance: Math.round(tol * 100000) / 100000,
    contacts: contacts.sort((x, y) => y.strength - x.strength),
    components: components.map((c) => c.map((d) => d.path)),
    interfaces,
    issues,
  };
}
