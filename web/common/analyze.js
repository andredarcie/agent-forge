// Scene analyzer: extracts the structured data an AI agent needs to reason
// about a model — dimensions, hierarchy, geometry stats, materials, the
// triangle budget, and a list of detected modeling issues.
import * as THREE from 'three';

// Default triangle budget for a game-ready low-poly asset. Rough guides:
// small prop 200-800, furniture/machine 800-2500, vehicle 2000-6000,
// character 3000-8000. Override per model with meta.budget.
export const DEFAULT_BUDGET = 3000;

const r4 = (n) => Math.round(n * 10000) / 10000;
const v3 = (v) => [r4(v.x), r4(v.y), r4(v.z)];

function triangleCount(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return 0;
  return Math.floor((geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3);
}

export function analyze(root, { meta = {}, modelName = root.name } = {}) {
  root.updateMatrixWorld(true);

  const stats = { objects: 0, meshes: 0, triangles: 0, vertices: 0, lights: 0 };
  const materialSet = new Map();
  const unnamedMeshes = [];
  const nonUniformScale = [];
  const degenerate = [];
  const bigTextures = [];
  const heavyMeshes = [];
  const namedObjects = new Set();

  root.traverse((o) => {
    stats.objects++;
    if (o.name) namedObjects.add(o.name);
    if (o.isLight) stats.lights++;
    if (o.isMesh) {
      stats.meshes++;
      const tris = triangleCount(o.geometry);
      stats.triangles += tris;
      if (o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        stats.vertices += o.geometry.attributes.position.count;
      }
      if (tris === 0) degenerate.push(pathOf(o));
      if (tris > 600) heavyMeshes.push({ path: pathOf(o), name: o.name, tris });
      if (!o.name) unnamedMeshes.push(pathOf(o) || '(root mesh)');
      const ws = new THREE.Vector3();
      o.getWorldScale(ws);
      const [a, b, c] = [Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)];
      if (Math.max(a, b, c) / Math.max(Math.min(a, b, c), 1e-9) > 4) nonUniformScale.push(pathOf(o));
      const mList = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mList) {
        if (!m) continue;
        for (const key of Object.keys(m)) {
          const t = m[key];
          if (t && t.isTexture && t.image && Math.max(t.image.width || 0, t.image.height || 0) > 1024) {
            bigTextures.push(`${pathOf(o)} (${t.image.width}x${t.image.height})`);
          }
        }
        if (!materialSet.has(m.uuid)) {
          materialSet.set(m.uuid, {
            name: m.name || '',
            type: m.type,
            color: m.color ? '#' + m.color.getHexString() : null,
            roughness: m.roughness !== undefined ? r4(m.roughness) : undefined,
            metalness: m.metalness !== undefined ? r4(m.metalness) : undefined,
            transmission: m.transmission ? r4(m.transmission) : undefined,
            emissive: m.emissive && m.emissive.getHex() !== 0 ? '#' + m.emissive.getHexString() : undefined,
            usedBy: 0,
          });
        }
        materialSet.get(m.uuid).usedBy++;
      }
    }
  });

  function pathOf(o) {
    const parts = [];
    let n = o;
    while (n && n !== root) {
      parts.unshift(n.name || `<unnamed ${n.type}>`);
      n = n.parent;
    }
    return parts.join('/');
  }

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const bounds = {
    size: v3(size),
    center: v3(center),
    min: v3(box.min),
    max: v3(box.max),
  };

  // ---- Hierarchy tree ------------------------------------------------------
  function node(o) {
    const b = new THREE.Box3().setFromObject(o);
    const s = b.getSize(new THREE.Vector3());
    const wp = o.getWorldPosition(new THREE.Vector3());
    const q = o.getWorldQuaternion(new THREE.Quaternion());
    const dirY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const entry = {
      name: o.name || '(unnamed)',
      type: o.isMesh ? 'Mesh' : o.type,
      worldPos: v3(wp),
      size: v3(s),
      worldBox: { min: v3(b.min), max: v3(b.max) },
      // world direction of this object's local +Y axis — use it to verify
      // which way lathe/cylinder parts and pivot groups actually point
      dirY: v3(dirY),
    };
    if (o.isMesh) {
      entry.triangles = triangleCount(o.geometry);
      entry.geometry = o.geometry ? o.geometry.type : null;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      entry.material = m ? (m.name || m.type) : null;
    }
    const kids = o.children.filter((c) => c.isMesh || c.isGroup || c.isObject3D);
    if (kids.length) entry.children = kids.map(node);
    return entry;
  }
  const tree = node(root);

  function treeLines(entry, prefix = '', isLast = true, isRoot = true) {
    const dims = `${entry.size[0].toFixed(3)}x${entry.size[1].toFixed(3)}x${entry.size[2].toFixed(3)}m`;
    const extra = entry.type === 'Mesh'
      ? ` [${entry.geometry || 'Geometry'}, ${entry.triangles} tris, ${entry.material || 'no material'}]`
      : '';
    const pos = ` @(${entry.worldPos.map((n) => n.toFixed(2)).join(',')})`;
    const line = isRoot
      ? `${entry.name} (${entry.type}) ${dims}`
      : `${prefix}${isLast ? '\\-- ' : '|-- '}${entry.name} (${entry.type}) ${dims}${extra}${pos}`;
    const lines = [line];
    const kids = entry.children || [];
    kids.forEach((k, i) => {
      const childPrefix = isRoot ? '' : prefix + (isLast ? '    ' : '|   ');
      lines.push(...treeLines(k, childPrefix, i === kids.length - 1, false));
    });
    return lines;
  }
  const treeText = treeLines(tree).join('\n');

  // ---- Issue detection -----------------------------------------------------
  const issues = [];
  const H = Math.max(size.y, 0.0001);

  if (stats.triangles === 0) {
    issues.push({ level: 'error', message: 'Model has zero triangles — build() returned empty or degenerate geometry.' });
  }
  if (Math.abs(box.min.y) > Math.max(0.002, H * 0.01)) {
    issues.push({
      level: 'warn',
      message: `Model is not grounded: lowest point at y=${r4(box.min.y)} (expected ~0). Call helpers.centerGround(root) at the end of build().`,
    });
  }
  const xzOff = Math.hypot(center.x, center.z);
  if (xzOff > Math.max(size.x, size.z) * 0.5) {
    issues.push({
      level: 'warn',
      message: `Model center is offset from origin by ${r4(xzOff)}m on XZ. Call helpers.centerGround(root) to recenter.`,
    });
  }
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim < 0.005) {
    issues.push({ level: 'warn', message: `Model is only ${r4(maxDim)}m across — likely wrong scale for units=meters.` });
  } else if (maxDim > 100) {
    issues.push({ level: 'warn', message: `Model is ${r4(maxDim)}m across — likely wrong scale for units=meters.` });
  }
  if (unnamedMeshes.length) {
    issues.push({
      level: 'warn',
      message: `${unnamedMeshes.length} unnamed mesh(es) — name every part so it can be targeted with --focus. E.g.: ${unnamedMeshes.slice(0, 3).join('; ')}`,
    });
  }
  if (degenerate.length) {
    issues.push({ level: 'error', message: `Degenerate meshes with 0 triangles: ${degenerate.slice(0, 5).join('; ')}` });
  }
  if (nonUniformScale.length) {
    issues.push({
      level: 'info',
      message: `Strongly non-uniform scale on: ${nonUniformScale.slice(0, 5).join('; ')} — fine for stretched primitives, but check for distortion.`,
    });
  }

  // ---- Low-poly budget checks -----------------------------------------------
  const budget = Number(meta.budget) > 0 ? Number(meta.budget) : DEFAULT_BUDGET;
  const pct = Math.round((stats.triangles / budget) * 100);
  if (stats.triangles > budget) {
    issues.push({
      level: 'warn',
      message: `POLY BUDGET EXCEEDED: ${stats.triangles.toLocaleString()} tris > budget ${budget.toLocaleString()} (${pct}%). ` +
        `Lower segment counts, replace curves with facets, or delete detail the silhouette doesn't need.` +
        (heavyMeshes.length ? ` Heaviest meshes: ${heavyMeshes.sort((x, y) => y.tris - x.tris).slice(0, 4).map((h) => `${h.path} (${h.tris})`).join('; ')}` : ''),
    });
  } else if (stats.triangles > budget * 0.85) {
    issues.push({
      level: 'info',
      message: `Approaching poly budget: ${stats.triangles.toLocaleString()} / ${budget.toLocaleString()} tris (${pct}%).`,
    });
  }
  const meshBudget = Math.max(600, Math.round(budget * 0.5));
  const tooHeavy = heavyMeshes.filter((h) => h.tris > meshBudget);
  if (stats.triangles <= budget && tooHeavy.length) {
    issues.push({
      level: 'info',
      message: `Single mesh(es) using a big slice of the budget: ${tooHeavy.sort((x, y) => y.tris - x.tris).slice(0, 3).map((h) => `${h.path} (${h.tris} tris)`).join('; ')} — check segment counts.`,
    });
  }
  if (bigTextures.length) {
    issues.push({
      level: 'warn',
      message: `Texture(s) larger than 1024px: ${bigTextures.slice(0, 3).join('; ')} — oversized for a low-poly asset; ` +
        `use the tex.* generators (default 256px) or pass { size: 512 }.`,
    });
  }

  return {
    model: modelName,
    meta,
    stats: { ...stats, materials: materialSet.size },
    bounds,
    budget: {
      budget,
      triangles: stats.triangles,
      pctOfBudget: pct,
      withinBudget: stats.triangles <= budget,
    },
    materials: [...materialSet.values()],
    namedObjects: [...namedObjects].sort(),
    issues,
    tree,
    treeText,
  };
}
