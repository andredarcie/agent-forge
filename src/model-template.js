// Model: __NAME__  (low-poly, game-ready)
// Units are METERS, Y is up, and the model should rest on y=0 (the ground).
// Build it from named parts so views can be focused with:
//   node bin/agentforge.mjs render __NAME__ --focus <PartName>
//
// Low-poly rules of thumb:
//  - Stay inside meta.budget triangles (report shows usage; default 3000).
//  - Silhouette first: spend triangles where the outline needs them, nowhere else.
//  - Every triangle should earn its place by changing the shape you actually see.
//  - Flat shading is the default: let the facets read as planes.
//  - Detail comes from textures (tex.*) and vertex colors before geometry.
import * as THREE from 'three';

export const meta = {
  name: '__NAME__',
  description: 'TODO: one-line description of what this model is',
  units: 'meters',
  budget: 1500,          // max triangles — the analyzer enforces this
};

/**
 * ctx.THREE    — the three.js namespace
 * ctx.mats     — PBR presets (MeshStandard/Physical, flat-shaded by default):
 *                plastic, glossyPlastic, matte, rubber, metal, chrome,
 *                brushedMetal, gold, brass, copper, paintedMetal, glass,
 *                frostedGlass, ceramic, wood, darkWood, fabric, skin,
 *                emissive(color, intensity), unlit(color), vertexColor(),
 *                textured(map), custom({...MeshPhysicalMaterial params})
 *                Add a texture to any preset: mats.plastic(0xfff, { map: tex.checker() })
 * ctx.tex      — procedural textures (256px, mipmapped, seeded):
 *                checker(c1,c2), grid(bg,line), stripes([colors]),
 *                bricks(brick,mortar), noise(base), wood(base), gradient(a,b),
 *                pixel([rows], palette)  <- draw pixel art from strings!
 *                canvas(size, drawFn)    <- raw 2D canvas escape hatch
 * ctx.helpers  — group(name, ...kids), mesh(name, geo, mat, {pos, rot, scale}),
 *                place(obj, pos, {rot, scale}),
 *                box(w,h,d), roundedBox(w,h,d,r) <- chamfered, cone(r,h,seg),
 *                cylinder(rTop,rBot,h,seg=12), capsule(r,h), sphere(r,10,7),
 *                icosphere(r,detail), lathe(profile,seg=16), tube(points,r),
 *                radialClone(obj, count, radius), mirrorX(obj),
 *                facet(geo)             <- hard per-face normals (bakes into GLB)
 *                quantizeVerts(geo, step) <- snap verts to a grid (chunky look)
 *                vertexPaint(mesh, fn)  <- per-vertex colors (fake AO, gradients)
 *                triCount(obj)          <- check your budget mid-build
 *                subtract(base, ...cutters), union(...), intersect(...)  <- CSG
 *                measure(obj), centerGround(root),
 *                snap(child, childLocal, target, targetLocal)  <- attach parts by
 *                  coincident anchor points instead of offset math (both objects
 *                  must already be in the scene graph),
 *                worldPos(obj, local?), dist(a, b)  <- verify placements numerically
 *
 * Attachment rules (enforced by the analyzer):
 *  - parts that mount together must OVERLAP geometry, not graze each other
 *  - emissive/glass parts are never structural mounts
 *  - enclosed-by-design parts: set part.userData.interior = true
 *
 * Must return a THREE.Object3D (usually a Group).
 */
export function build({ THREE, mats, helpers: H, tex }) {
  const root = H.group('__NAME__');

  // --- Replace from here: a simple placeholder crate (~50 tris) ---
  const body = H.mesh(
    'Body',
    H.roundedBox(0.2, 0.2, 0.2, 0.012),
    mats.textured(tex.wood(0x9a6a34, { planks: 2 })),
    { pos: [0, 0.1, 0] }
  );
  root.add(body);
  // --- to here ---

  // Guarantees the model is centered on the origin and resting on the ground.
  return H.centerGround(root);
}
