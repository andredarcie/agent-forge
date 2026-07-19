# AgentForge — AI-native low-poly 3D modeling (Three.js)

This tool does ONE thing and aims to be the best in the world at it:
**high-quality low-poly 3D models**. You (the AI agent) build models by writing
JavaScript in `models/*.js`, rendering them headlessly, **looking at the
rendered images**, and iterating. Everything runs locally; renders take a few
seconds.

Renders come out of a neutral PBR studio: image-based lighting from a room
environment, a warm key with soft shadows, cool fill and rim, ACES tone
mapping, on a shadow-catching floor with a reference grid. The studio exists to
judge form — it never stylizes the model.

## The design philosophy (what makes a model GOOD here)

1. **Silhouette first.** A low-poly model is read by its outline before
   anything else. Spend triangles where the outline needs them; delete
   everything else. If a triangle does not change the shape you actually see,
   it is waste.
2. **Budget is law.** `meta.budget` (default 3000) is enforced by the analyzer.
   Guides: small prop 200–800, furniture/machine 800–2500, vehicle 2000–6000,
   character 3000–8000. If you are over, simplify — do not raise the budget
   without a reason.
3. **Facets are the aesthetic, not a compromise.** Materials are flat-shaded by
   default so every triangle catches its own value. Keep segment counts low
   enough that the planes read: 8–16 per cylinder, 10×7 spheres, 16-segment
   lathes. Reach for `{ flatShading: false }` only on genuinely organic
   surfaces (skin, cloth). A curve that looks perfectly smooth usually means
   triangles were spent for nothing.
4. **Deliberate, even topology.** Facet sizes should be reasonably consistent
   across a surface — a dense patch next to a coarse one reads as a mistake.
   Chamfer with `roundedBox` instead of filleting; a single chamfer loop does
   more for perceived quality than a dozen smoothing segments.
5. **Detail comes from shading before geometry.** Panel lines, grain, wear,
   fake ambient occlusion: paint them with `H.vertexPaint` (free, no texture)
   or `tex.*` (256px, mipmapped) before you consider modeling them.
6. **Color with intent.** Materials are PBR (metalness/roughness), lit by a
   real environment, so metals need `metalness: 1` and a low roughness to read
   as metal. The studio applies ACES tone mapping, which desaturates roughly
   15% — pre-saturate slightly to land on the tone you intend. A cohesive,
   slightly restrained palette reads as designed; ten saturated hues read as a
   test scene.
7. **Clean is the default; wear is a choice.** The `tex.*` generators no longer
   bake in grime. Add it deliberately (`{ dirty: 0.2 }`, or `tex.grunge`
   multiplied over a color) when the object should look used.

## The core loop

```
1. node bin/agentforge.mjs new <name>          # scaffold models/<name>.js
2. edit models/<name>.js                       # write/refine the geometry
3. node bin/agentforge.mjs render <name>       # render + data report
4. READ renders/<name>/sheet.png               # ← ACTUALLY LOOK at the image
5. go to 2 until the form reads right at a glance
```

Step 4 is not optional. The contact sheet shows 8 views (2 perspective, 5
orthographic, 1 wireframe) plus a data card with the budget bar. Visually
check: proportions, part placement, interpenetration, floating parts, wrong
orientations, material readability — AND the craft read: is the silhouette
clear? do the facets sit evenly, or is one patch mangled? does anything look
accidentally smooth or accidentally faceted? Read the wireframe cell to judge
topology, not just the beauty views. Parts flagged by structural issues get
automatic close-up cells (orange border) appended to the sheet — never ignore
them.

## Mandatory verification protocol (learned the hard way)

Full-model views hide local errors: a lamp was once shipped "looking right"
while its shade was attached by the rim to the arm, with the joint floating in
front of the bulb. Before declaring any model done:

1. **Zero `[warn]`/`[error]` issues.** Structural errors (TENUOUS ATTACHMENT,
   FLOATING ASSEMBLY, NON-STRUCTURAL SUPPORT, INVISIBLE PART) and budget
   errors (POLY BUDGET EXCEEDED, oversized textures) are never acceptable.
2. **Read the "Assembly interfaces" section** of the render output. For each
   group it lists exactly which parts carry it. Ask: does this mount make
   physical sense? A shade mounted "via Bulb" or "GRAZING" is wrong even if it
   renders pretty.
3. **Close-up every joint/attachment** in articulated or multi-assembly models:
   `render <name> --focus JointA,JointB,Head --views persp,front --no-sheet`
   and READ those images. Full-model views are too small to judge attachments.
4. **Verify positions numerically, not by mental rotation math.** Use the
   report's per-node `worldPos`, `worldBox` and `dirY`, or `H.worldPos(obj)` /
   `H.dist(a, b)` inside build(), to confirm e.g. "the shade's back sits at
   the joint" (distance ≈ 0) instead of trusting offset arithmetic.
5. **Attach by anchor points, not offsets:** `H.snap(child, childLocalPoint,
   target, targetLocalPoint)` welds a child so the two points coincide.
6. **Contact strength comes from CLOSE PARALLEL SURFACES, not deep burial.**
   The analyzer samples each surface and counts points within tolerance
   (~1% of model size) of the other surface. Burying a big box deep inside
   another only produces a thin crossing ring (reads as GRAZING). To make a
   stacked joint strong, overlap the sections a FEW MILLIMETERS so the two
   large faces sit near-coplanar — e.g. a cabinet section whose bottom face
   is 8mm below the top face of the section beneath it (see models/arcade-cabinet.js).
   Concretely: **aim for ~8mm face separation on a ~1.5m model** — 12-15mm sits
   at the tolerance edge and flakes between runs. And since strength ≈ contact
   area / the part's TOTAL surface, long thin parts (arms, columns) need a
   proportionally larger overlap band than squat ones to clear the 0.13 bar.

## Commands

```
node bin/agentforge.mjs new <name>              scaffold a new model
node bin/agentforge.mjs render <name>           render → renders/<name>/
    --focus <ObjectName>                        close-up framed on one named part
    --isolate                                   (with --focus) hide everything else
    --views persp,front,top,...                 subset of: persp persp2 front back right left top bottom wire
    --turntable                                 add 8 rotating views (views/turn0..7.png)
    --size 1280x960                             output size (default 960x720)
    --no-sheet                                  skip contact sheet (faster for quick checks)
node bin/agentforge.mjs inspect <name>          full JSON report only, no images (fastest)
node bin/agentforge.mjs export <name>           → exports/<name>.glb
node bin/agentforge.mjs dev                     live viewer at http://127.0.0.1:4747 (hot reload)
node bin/agentforge.mjs list                    list models
```

Iteration tips:
- **Commands are cheap (~3-5s each: full render ~4s, inspect ~2.5s).** The real
  cost of an iteration is the agent READING IMAGES. So: verify structure,
  positions and issues with `inspect`/the text report (fast); read images only
  to judge the LOOK. Don't re-read a full 9-cell sheet when a single
  `--views persp --no-sheet` PNG answers the question.
- Independent renders (e.g. close-ups of different parts) can run in parallel —
  each call is its own process.
- Quick shape check: `render <name> --views persp,front,right --no-sheet` then read the 3 PNGs.
- Detail work on one part: `render <name> --focus PartName --views persp,front --no-sheet`.
- Judging topology (facet distribution, stray triangles): read the `wire` view.
- The studio applies ACES tone mapping, which desaturates ~15%: pre-saturate
  material colors to land on the intended tone (see models/tiny-theft-man.js).
- `report.json` / `inspect` give exact world positions and sizes of every named
  part — use them to compute joint positions instead of guessing.

## Model file contract (`models/<name>.js`)

```js
import * as THREE from 'three';                    // full three.js available
// import { X } from 'three/addons/...';          // all three.js addons available

export const meta = {
  name, description, units: 'meters',
  budget: 800,                // triangle budget (default 3000) — enforced
};

export function build({ THREE, mats, helpers: H, tex }) {   // may be async
  const root = H.group('MyModel');
  root.add(H.mesh('Body', H.box(0.2, 0.1, 0.1), mats.plastic(0x4a90d9)));
  return H.centerGround(root);                     // ALWAYS end with this
}
```

Rules that keep quality high (violations are flagged in the report's `issues`):
- **Units are meters, Y is up.** A mug is ~0.1 m, a chair ~0.9 m, a car ~4.5 m.
- **Model must rest on y=0** — `H.centerGround(root)` as the return guarantees it.
- **Name every mesh, group AND material in English PascalCase.** Names become
  glTF node/mesh/material names on export and `--focus` targets, so they must
  be portable — English only, no `""`, no two different materials sharing a
  name (name shared `mats.*` instances via `{ name: 'WoodFront' }`). Export
  auto-uniquifies collisions and copies names onto glTF meshes as a safety
  net, but get it right in the model.
- **Articulated models rest in a NEUTRAL/closed pose.** Doors shut, drawers in,
  arms folded — offset 0. Expose the motion through a constant (e.g.
  `OPEN.middle = 0.25`) and a metadata hint, not by shipping the asset
  mid-motion. An integrator expects to receive the rest pose and animate from
  there. See models/dresser.js.
- **Build hierarchically with pivot groups.** For articulated parts, position
  the group at the joint, add the geometry offset inside it, rotate the group.
- **Stay inside the budget** — check `H.triCount(root)` mid-build if unsure.
- **Use `mats` presets.** They are PBR (metalness/roughness) and flat-shaded by
  default. `mats.unlit` is legitimate for screens, signs and decals.

## Available context

`mats.*` — flat-shaded PBR materials (each returns a fresh instance; last arg =
param overrides, e.g. `mats.plastic(0xffffff, { map: tex.checker() })`):
plastic(color), glossyPlastic(color), matte(color), rubber(color),
metal(color, rough), chrome(), brushedMetal(color), gold(), brass(), copper(),
paintedMetal(color), glass(color), frostedGlass(color), ceramic(color),
wood(color), darkWood(), fabric(color), skin(color),
emissive(color, intensity), unlit(colorOrWhite, {map}), vertexColor(),
textured(map), custom({any MeshPhysicalMaterial params})
- **Presets are MeshStandard/MeshPhysical, flat-shaded by default** — the
  facets are the look. Add a texture with `{ map: tex.wood(...) }`.
- Pass `{ flatShading: false }` for smooth normals on organic shapes only.
- Metals need `metalness: 1` to read as metal under the environment light; the
  `metal`/`chrome`/`gold`/`brass`/`copper` presets already set it.
- glass/frostedGlass are alpha-blended and count as non-structural, like
  emissive — never make them the only mount.

`tex.*` — procedural textures (256px default, mipmapped + linear filtering,
seeded/deterministic). Wear is opt-in, not baked in. >1024px is flagged:
- Surfaces: `tex.wood(base, {planks, horizontal})` (grain streaks, knots, plank
  seams), `tex.concrete(base)`, `tex.metalWorn(base)`, `tex.noise(base,
  {amount})` (fractal tone), `tex.grunge(base, {amount})` (heavy stains — great
  multiplied over a color as dirt).
- Patterns (clean by default; pass `dirty: 0.2` to age them):
  `tex.checker(c1, c2, {cells})`, `tex.grid(bg, line)`, `tex.stripes([colors])`,
  `tex.bricks(brick, mortar)`.
- `tex.gradient(top, bottom)` — vertical gradient (skies, glows).
- `tex.pixel([rows], palette)` — **pixel art from strings**, one char per texel
  (`'.'`/`' '` = transparent), always nearest-filtered. Screens, signs, decals.
  See models/arcade-cabinet.js for a screen and a marquee.
- `tex.canvas(size, (ctx, w, h) => {...})` — raw 2D-canvas escape hatch.
- Textures tile: `t.repeat.set(4, 2)` on the returned texture.

`helpers.*` (aliased `H`):
- `group(name, ...children)` / `mesh(name, geo, mat, {pos:[x,y,z], rot:[rx,ry,rz], scale})`
- `place(obj, [x,y,z], {rot, scale})` — terse transform, returns obj
- **Primitives** (segment defaults are already low-poly-appropriate — don't
  raise them casually): `box(w,h,d)` (12 tris), `roundedBox(w,h,d,r?)` (chamfered),
  `cylinder(rTop, rBottom, h, seg=12)` / `cone(r, h, seg=8)` / `capsule(r, h)`
  (base at y=0), `sphere(r, 10, 7)`, `icosphere(r, detail)` (20/80/320 tris),
  `lathe([[radius, y], ...], seg=16)`, `tube([[x,y,z], ...], radius)`
- **Shaping tools**: `facet(geo)` — hard per-face normals (also bakes into GLB);
  `quantizeVerts(geo, step)` — snap verts to a world grid (chunky organic
  shapes); `vertexPaint(meshOrGeo, ([x,y,z]) => color)` — per-vertex colors
  for fake AO/gradients (auto-enables vertexColors); `triCount(obj)`
- `marker(name, {pos, rot, data})` — empty named node (no geometry) as a
  metadata anchor: item slots, hardpoints, attachment/snap points. `data` is
  merged into userData and exported as glTF `extras`, so an engine reads the
  intent from `node.userData` instead of guessing by bounding box. Skipped by
  the contact/visibility checks.
- `radialClone(obj, count, radius, {y, faceCenter})` — spokes, legs, bolts
- `mirrorX(obj)` — mirrored clone (left/right symmetry)
- `measure(obj)` → `{size, center, min, max}` in world space
- `snap(child, childLocal, target, targetLocal)` — move child so two anchor
  points coincide; the safe way to attach parts across rotated frames (both
  must be in the scene graph already)
- `subtract(base, ...cutters)` / `union(base, ...adds)` / `intersect(base, ...)` —
  CSG booleans on Mesh instances (transforms respected, result gets the base's
  material/name). CSG rules (each learned from a real failure):
  1. Cutters in one `subtract()` call must be pairwise disjoint — it throws on
     AABB overlap because the engine corrupts normals on overlapping cutters.
  2. Never place a cutter surface exactly coplanar with a base surface — nudge
     centers >= 1mm off face planes.
  3. ExtrudeGeometry/ShapeGeometry caps are hostile CSG topology: cuts through
     them silently fail or invert. For solids that will be cut, build the base
     from CSG-clean primitives (see models/swiss-cheese.js).
- `worldPos(obj, local?)` → `[x,y,z]` world coords of a local point
- `dist(a, b, aLocal?, bLocal?)` — world distance between two objects' points
- `centerGround(root)` — recenter on origin + drop onto y=0

Mark intentionally enclosed parts (a motor inside a housing) with
`part.userData.interior = true` so the visibility check knows they are meant
to be hidden.

## Exporting for use in an engine (`export <name>` → `exports/<name>.glb`)

The GLB is meant to drop into Blender/Unity/Godot/Unreal/three.js with zero
cleanup. `build()` well and the export handles the rest:

- **Everything named** — nodes, glTF meshes and materials all carry the model's
  names (export copies names onto anonymous glTF meshes and uniquifies
  duplicate material names automatically).
- **TRS transforms** — every node exports translation/rotation/scale, never a
  raw `matrix`, so transforms are readable and animatable.
- **Metadata via `userData` → glTF `extras`** — anything you put in
  `obj.userData` is exported and surfaces in `GLTFLoader` as `node.userData`.
  Use it to encode intent the geometry can't:
  - root: `userData.units='meters'` (glTF is meters by spec — 1 unit = 1 m),
    `up='+y'`, `front='+z'`.
  - articulated parts: `userData.kind`, `openAxis`, `travel` (meters of motion),
    `closedZ`, so the engine animates without reverse-engineering the rig.
  - `H.marker(...)` for item slots / hardpoints / snap points — an empty node
    the engine positions objects against.
- **Rest pose** — model closed/neutral (see the rest-pose rule above), so the
  received asset is the canonical state.

Materials export straight through: the `mats.*` presets are already glTF's
metalness/roughness model, and `facet()` bakes hard normals into the mesh, so
the faceted look survives the round trip into any engine.

## Reading the render output

`render` prints: dimensions, triangle/mesh counts, **budget usage**,
materials, **assembly interfaces**, **issues**, and the full structure tree
with world position + size of every part. `renders/<name>/report.json`
additionally contains:

- `budget` — budget, triangles, pctOfBudget, withinBudget
- `structure.contacts` — every touching pair of meshes with `gap` (meters) and
  `strength` (fraction of surface samples in contact; <0.1 = grazing, likely
  accidental; >=0.13 = real overlap/attachment)
- `structure.interfaces` — per group: the contacts crossing its boundary (how
  it is mounted), with `grazing` and `viaNonStructural` flags
- `visibility` — per part: pixels visible from each of the 8 standard views
- per tree node: `worldPos`, `worldBox`, `size`, `dirY`
- `namedObjects` — valid `--focus` targets

Treat every `[warn]`/`[error]` issue as a bug to fix. Structural ones:

- **FLOATING ASSEMBLY** — parts touch nothing; attach them with real overlap
- **TENUOUS ATTACHMENT** — an assembly held only by a grazing contact; make
  the mounting faces sit close and parallel (protocol rule 6) or weld with `H.snap`
- **NON-STRUCTURAL SUPPORT** — an assembly carried by an emissive/glass part;
  route the mount through solid parts
- **INVISIBLE PART** — swallowed geometry; fix its position or mark
  `userData.interior = true` if intentional

Budget ones: **POLY BUDGET EXCEEDED** (simplify the flagged heavy meshes
first), **oversized textures** (use the tex.* generators).
Others: not grounded, wrong scale for meters, unnamed meshes, degenerate geometry.

## Reference models

- `models/arcade-cabinet.js` — the showcase: box modeling, chamfers, tex.pixel
  screen + marquee, unlit/emissive done right, vertex-paint AO, near-coplanar
  stacked joints, 680/800 tris.
- `models/dresser.js` — articulated furniture done export-ready:
  drawers as sliding pivot groups in a closed rest pose (an `OPEN` constant
  slides them), English node/material names, glTF `extras` metadata
  (`openAxis`/`travel` per drawer, `ItemSlot*` marker nodes, root units/axes),
  CSG one-piece drawer trays (thin perpendicular joints always read as
  tenuous), square-section corner battens bridging perpendicular panels,
  runner frames with side guides (union) so drawers mount through what they
  slide on, horizontal-grain wood fronts.
- `models/example-lamp.js` — articulation via nested pivot groups, lathe/tube
  helpers, and a low-seg lathe dome whose facets read as the shape (2,016/2,500).
- `models/swiss-cheese.js` — the CSG reference: documents the clean-base
  technique and keeps segment counts low so the booleans stay robust.
- `models/tiny-theft-man.js` — voxel-art character built entirely from boxes,
  with a per-cell jitter map standing in for per-voxel tone.

## Architecture (for maintaining the tool itself)

- `bin/agentforge.mjs` — CLI dispatch
- `src/server.mjs` — static server + SSE hot reload + screenshot API
- `src/capture.mjs` — puppeteer-core orchestration (uses local Chrome/Edge, no download)
- `web/headless.{html,js}` — capture page: renders views, composes sheet, exports GLB
- `web/viewer.{html,js}` — live viewer (OrbitControls, data panel, hot reload)
- `web/common/` — shared:
  - `textures.js` — the `tex.*` procedural texture toolkit
  - `materials.js` — flat-shaded MeshStandard/MeshPhysical presets
  - `stage.js` — the PBR studio (IBL from RoomEnvironment, key/fill/rim, soft
    shadows, shadow-catcher floor + grid) and the named-view camera system
  - `helpers.js` — geometry helpers + shaping tools (facet, quantizeVerts,
    vertexPaint)
  - `analyze.js` — report generator + budget/texture checks
  - `contacts.js` — BVH contact graph (floating/tenuous/non-structural checks)
  - `visibility.js` — per-part ID-pass pixel coverage (swallowed/hidden parts)
- Headless WebGL runs on SwiftShader (`--enable-unsafe-swiftshader`); browser
  located by `src/browser-finder.mjs`, overridable via `AGENTFORGE_BROWSER` env var.
