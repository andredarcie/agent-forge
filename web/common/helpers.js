// Geometry and scene-building helpers available to model files via ctx.helpers.
// All dimensions are in meters, Y is up. Segment defaults are tuned for the
// low-poly aesthetic — chunky silhouettes over smooth curves. Raise them
// only when a curve genuinely reads badly, and check the triangle budget.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION, INTERSECTION } from 'three-bvh-csg';
import { cleanBooleanResult, validateGeometry } from './meshclean.js';

/** Named group with optional children. */
export function group(name, ...children) {
  const g = new THREE.Group();
  g.name = name;
  for (const c of children) g.add(c);
  return g;
}

/** Named, shadow-enabled mesh with optional transform. */
export function mesh(name, geometry, material, { pos, rot, scale } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  // Name the geometry too, so exported glTF `meshes[]` carry names (the node
  // name alone leaves the glTF mesh anonymous). Don't clobber an already-named
  // (possibly shared) geometry.
  if (geometry && !geometry.name) geometry.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  if (scale !== undefined) {
    if (Array.isArray(scale)) m.scale.set(...scale);
    else m.scale.setScalar(scale);
  }
  return m;
}

/**
 * Empty named node — a metadata anchor with no geometry. Use it to mark an
 * attachment point, an item slot inside a container, a muzzle/hardpoint, etc.
 * `data` is merged into userData and exported as glTF `extras`, so an engine's
 * GLTFLoader reads the intent (node.userData) instead of guessing by bounding
 * box. Marked userData.marker=true; skipped by the contact/visibility checks.
 *
 *   drawer.add(H.marker('ItemSlot', { pos: [0, 0.02, 0.05] }));
 */
export function marker(name, { pos, rot, scale, data } = {}) {
  const o = new THREE.Object3D();
  o.name = name;
  o.userData.marker = true;
  if (data) Object.assign(o.userData, data);
  if (pos) o.position.set(...pos);
  if (rot) o.rotation.set(...rot);
  if (scale !== undefined) {
    if (Array.isArray(scale)) o.scale.set(...scale);
    else o.scale.setScalar(scale);
  }
  return o;
}

/** Terse transform: place(obj, [x,y,z], { rot:[rx,ry,rz], scale }) — returns obj. */
export function place(obj, pos = [0, 0, 0], { rot, scale } = {}) {
  obj.position.set(...pos);
  if (rot) obj.rotation.set(...rot);
  if (scale !== undefined) {
    if (Array.isArray(scale)) obj.scale.set(...scale);
    else obj.scale.setScalar(scale);
  }
  return obj;
}

/** Plain box — the fundamental low-poly primitive. 12 triangles, centered. */
export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/**
 * Box with CHAMFERED edges (segments=1 gives flat 45° bevels, the classic
 * "softened box"). More segments = rounder = more triangles.
 */
export function roundedBox(w, h, d, radius = Math.min(w, h, d) * 0.06, segments = 1) {
  return new RoundedBoxGeometry(w, h, d, segments, radius);
}

/**
 * Surface of revolution around the Y axis.
 * profile: array of [radius, y] pairs, bottom to top.
 */
export function lathe(profile, segments = 16) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, segments);
}

/**
 * Tube along a series of [x,y,z] points (Catmull-Rom).
 */
export function tube(points, radius = 0.01, { radialSegments = 8, tubularSegments = 24, closed = false } = {}) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, closed);
}

/** Low-poly UV sphere, centered. 10x7 segments keeps the facets readable. */
export function sphere(radius, widthSegments = 10, heightSegments = 7) {
  return new THREE.SphereGeometry(radius, widthSegments, heightSegments);
}

/**
 * Icosphere — evenly faceted sphere, better triangle distribution than a UV
 * sphere at low counts. detail 0 = 20 tris, 1 = 80 tris, 2 = 320 tris.
 */
export function icosphere(radius, detail = 1) {
  return new THREE.IcosahedronGeometry(radius, detail);
}

/** Cone standing on Y axis, base at y=0. 8 sides reads as low-poly. */
export function cone(radius, height, radialSegments = 8) {
  const g = new THREE.ConeGeometry(radius, height, radialSegments);
  g.translate(0, height / 2, 0);
  return g;
}

/**
 * Clone `obj` `count` times in a circle of `radius` on the XZ plane.
 * Each clone is rotated to keep its original orientation relative to the center.
 */
export function radialClone(obj, count, radius, { y = 0, startAngle = 0, faceCenter = true } = {}) {
  const g = new THREE.Group();
  g.name = (obj.name || 'radial') + 'Array';
  for (let i = 0; i < count; i++) {
    const a = startAngle + (i / count) * Math.PI * 2;
    const c = obj.clone();
    c.name = `${obj.name || 'item'}_${i}`;
    c.position.set(Math.sin(a) * radius, y, Math.cos(a) * radius);
    if (faceCenter) c.rotation.y = a;
    g.add(c);
  }
  return g;
}

/** Mirrored clone across the YZ plane (X negated). Materials are cloned and made double-sided so flipped winding still renders correctly. */
export function mirrorX(obj) {
  const c = obj.clone(true);
  c.name = (obj.name || 'obj') + 'Mirror';
  c.scale.x *= -1;
  c.traverse((n) => {
    if (n.isMesh) {
      n.material = Array.isArray(n.material)
        ? n.material.map((m) => Object.assign(m.clone(), { side: THREE.DoubleSide }))
        : Object.assign(n.material.clone(), { side: THREE.DoubleSide });
    }
  });
  return c;
}

/**
 * Recenter on the XZ origin and drop the model so its lowest point sits at y=0.
 * Call as the last step of build() to guarantee a grounded, centered model.
 */
export function centerGround(obj, { ground = true, centerXZ = true } = {}) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  if (centerXZ) {
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    obj.position.x -= cx;
    obj.position.z -= cz;
  }
  if (ground) obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  return obj;
}

/** World coordinates of a point given in obj's local space (default: its origin). */
export function worldPos(obj, local = [0, 0, 0]) {
  obj.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(...local).applyMatrix4(obj.matrixWorld);
  return [p.x, p.y, p.z];
}

/**
 * Move `child` so that its local point `childLocal` lands exactly on
 * `target`'s local point `targetLocal` — attachment by coincident anchor
 * points instead of error-prone offset math in nested rotated frames.
 * Both objects must already be added to the scene graph. Returns child.
 *
 * Example — weld the closed back of a lathe shade (back at local [0,0,0])
 * onto a joint sphere:  H.snap(shade, [0,0,0], headJoint, [0,0,0])
 */
export function snap(child, childLocal, target, targetLocal = [0, 0, 0]) {
  if (!child.parent) throw new Error('snap(): child must be added to a parent first');
  child.updateWorldMatrix(true, false);
  target.updateWorldMatrix(true, false);
  const targetWorld = new THREE.Vector3(...targetLocal).applyMatrix4(target.matrixWorld);
  const childWorld = new THREE.Vector3(...childLocal).applyMatrix4(child.matrixWorld);
  const deltaWorld = targetWorld.sub(childWorld);
  // convert the world-space correction into the child's parent frame
  const parentRot = child.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const parentScale = child.parent.getWorldScale(new THREE.Vector3());
  deltaWorld.applyQuaternion(parentRot).divide(parentScale);
  child.position.add(deltaWorld);
  child.updateWorldMatrix(true, false);
  return child;
}

/** World-space distance between the origins (or given local points) of two objects. */
export function dist(a, b, aLocal = [0, 0, 0], bLocal = [0, 0, 0]) {
  const pa = worldPos(a, aLocal);
  const pb = worldPos(b, bLocal);
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}

/** World-space bounding measurements: { size:[w,h,d], center, min, max }. */
export function measure(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    size: [size.x, size.y, size.z],
    center: [center.x, center.y, center.z],
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/** Capsule standing on Y axis, base at y=0. */
export function capsule(radius, height, { radialSegments = 10, capSegments = 4 } = {}) {
  const g = new THREE.CapsuleGeometry(radius, Math.max(height - radius * 2, 0.0001), capSegments, radialSegments);
  g.translate(0, height / 2, 0);
  return g;
}

/** Cylinder standing on Y axis, base at y=0. 12 sides reads as low-poly. */
export function cylinder(radiusTop, radiusBottom, height, radialSegments = 12) {
  const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  g.translate(0, height / 2, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Low-poly shaping tools
// ---------------------------------------------------------------------------

/**
 * Facet a geometry: un-share every vertex and recompute per-face normals so
 * the surface renders as hard flat polygons even with smooth-shading
 * materials. Also bakes the faceted look into GLB exports.
 */
export function facet(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

/**
 * Snap every vertex position to a world grid (in meters). The digital
 * "hand-modeled on a grid" look — also great for making organic lathe shapes
 * chunkier. Returns the same geometry, mutated.
 */
export function quantizeVerts(geometry, step = 0.005) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      Math.round(pos.getX(i) / step) * step,
      Math.round(pos.getY(i) / step) * step,
      Math.round(pos.getZ(i) / step) * step
    );
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Paint per-vertex colors — the cheapest "texture": gradients, fake AO,
 * dirt. fn receives the vertex position in LOCAL space ([x,y,z]) and returns
 * a color (hex number, CSS string, or THREE.Color).
 *
 *   H.vertexPaint(bodyMesh, ([x, y, z]) => y > 0.5 ? 0xdddddd : 0x777777);
 *
 * Accepts a Mesh (enables vertexColors on its material) or a raw geometry.
 */
export function vertexPaint(target, fn) {
  const geometry = target.isMesh ? target.geometry : target;
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.set(fn([pos.getX(i), pos.getY(i), pos.getZ(i)]));
    c.convertSRGBToLinear();
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (target.isMesh) {
    const mList = Array.isArray(target.material) ? target.material : [target.material];
    for (const m of mList) { m.vertexColors = true; m.needsUpdate = true; }
  }
  return target;
}

/** Total triangle count under an object — check your budget mid-build(). */
export function triCount(obj) {
  let tris = 0;
  obj.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) {
      tris += Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    }
  });
  return tris;
}

// ---------------------------------------------------------------------------
// CSG boolean operations (three-bvh-csg). Each takes THREE.Mesh instances
// (their position/rotation/scale are respected) and returns a NEW mesh named
// and materialed after the base. Cutter transforms are baked into the result.
// ---------------------------------------------------------------------------
const _evaluator = new Evaluator();
_evaluator.useGroups = false; // result is a single clean mesh with the base material

function _toBrush(mesh) {
  const b = new Brush(mesh.geometry, mesh.material);
  mesh.updateMatrixWorld(true);
  b.applyMatrix4(mesh.matrixWorld);
  b.updateMatrixWorld(true);
  return b;
}

function _csg(base, others, op) {
  let result = _toBrush(base);
  for (const o of others) {
    result = _evaluator.evaluate(result, _toBrush(o), op);
  }
  // evaluate() expresses the result in the FIRST brush's local frame — bake
  // the base's transform into the output geometry so world placement holds
  // even when the base mesh itself is positioned/rotated.
  let geometry = result.geometry;
  base.updateMatrixWorld(true);
  geometry.applyMatrix4(base.matrixWorld);

  // The evaluator emits a triangle soup with T-junctions where a cut crosses an
  // existing face, so ~45% of the raw result's edges belong to a single
  // triangle. Weld, split those edges, drop the slivers the split produces and
  // rebuild normals, so what leaves here is a closed surface.
  geometry = cleanBooleanResult(geometry);
  const check = validateGeometry(geometry, { label: base.name || 'csg' });
  if (!check.ok) {
    throw new Error(
      `CSG result for "${base.name || '(unnamed)'}" is invalid:\n  ` + check.errors.join('\n  ')
    );
  }
  geometry.name = base.name; // carry the name onto exported glTF meshes
  const out = new THREE.Mesh(geometry, base.material);
  out.name = base.name;
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

/**
 * Boolean subtraction: base minus every cutter. subtract(base, c1, c2, ...)
 *
 * Cutters must be pairwise DISJOINT (their AABBs must not overlap). Both
 * strategies for overlapping cutters — sequential subtraction and
 * union-then-subtract — produce inverted-normal artifacts (craters render as
 * bumps) with the underlying CSG engine, so overlap fails loudly instead of
 * corrupting geometry silently.
 */
export function subtract(base, ...cutters) {
  const boxes = cutters.map((c) => {
    c.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(c);
  });
  for (let i = 0; i < cutters.length; i++) {
    for (let j = i + 1; j < cutters.length; j++) {
      if (boxes[i].intersectsBox(boxes[j])) {
        throw new Error(
          `subtract(): cutters "${cutters[i].name || i}" and "${cutters[j].name || j}" overlap. ` +
          `The CSG engine produces inverted-normal artifacts for overlapping cutters — ` +
          `separate them so their bounding boxes are disjoint.`
        );
      }
    }
  }
  let result = base;
  for (const c of cutters) result = _csg(result, [c], SUBTRACTION);
  return result;
}

/** Boolean union: merge meshes into one watertight mesh. */
export function union(base, ...adds) {
  return _csg(base, adds, ADDITION);
}

/** Boolean intersection: the volume common to all meshes. */
export function intersect(base, ...others) {
  return _csg(base, others, INTERSECTION);
}
