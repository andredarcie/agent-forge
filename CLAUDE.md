# AgentForge PSX — AI-native low-poly 3D modeling (PS1 aesthetic, Three.js)

This tool does ONE thing and aims to be the best in the world at it: **low-poly
3D models with an authentic PlayStation-1 aesthetic**. You (the AI agent) build
models by writing JavaScript in `models/*.js`, rendering them headlessly through
a faithful PS1 pipeline, **looking at the rendered images**, and iterating.
Everything runs locally; renders take a few seconds.

Every render is processed like 1997: a 320×240 framebuffer upscaled with
nearest-neighbor, RGB555 color (15-bit) with the PS1 GPU's 4×4 ordered dither,
vertex snapping to the pixel grid (polygon jitter), affine texture warping,
flat-shaded Lambert/Phong materials, no shadow maps, no tone mapping, and a
blob shadow on a checkerboard floor.

## The PSX design philosophy (what makes a model GOOD here)

1. **Silhouette first.** Spend triangles where the outline needs them; delete
   everything else. A PS1 artist got a whole character in 400 tris.
2. **Budget is law.** `meta.psx.budget` (default 1500) is enforced by the
   analyzer. Guides: small prop 100–400, furniture/machine 300–800, hero
   prop/character 800–1500. If you're over, simplify — don't raise the budget
   without a reason.
3. **Chunky is correct.** 8–12 segments per cylinder, 10×7 spheres, chamfers
   instead of fillets. If a curve looks smooth in the render, you wasted tris.
4. **Detail lives in textures and vertex colors, not geometry.** Panel lines,
   grain, screws, decals: draw them with `tex.*` (64px, point-sampled) or
   paint them with `H.vertexPaint` (fake AO, gradients).
5. **Photographic, never cartoon.** PS1 games textured everything with
   digitized photos (Metal Gear Solid, Resident Evil, Gran Turismo). Every
   `mats.*` preset already carries subtle photo grain by default; the `tex.*`
   generators bake in fractal tone variation, grime and wear. Amplify that:
   muted/desaturated palettes over pure hues, dirt over cleanliness. Flat
   vector-looking fills are a defect. Reserve `tex.pixel` for screens, signs
   and decals — never as a surface material.
6. **Big textured quads warp.** Affine mapping bends textures on large polygons
   seen at an angle — authentic, but if it garbles something important
   (text, a face), subdivide that surface or shrink the quad, exactly like a
   1997 artist would.
7. **PBR is forbidden.** MeshStandard/MeshPhysical break the look and get
   flagged. Use `mats.*` presets (Lambert/Phong) or `mats.unlit`.

## The core loop

```
1. node bin/agentforge.mjs new <name>          # scaffold models/<name>.js
2. edit models/<name>.js                       # write/refine the geometry
3. node bin/agentforge.mjs render <name>       # PSX render + data report
4. READ renders/<name>/sheet.png               # ← ACTUALLY LOOK at the image
5. go to 2 until it looks right AND reads as PS1
```

Step 4 is not optional. The contact sheet shows 8 views (2 perspective, 5
orthographic, 1 wireframe) plus a data card with the budget bar. Visually
check: proportions, part placement, interpenetration, floating parts, wrong
orientations, material readability — AND the PSX read: is the silhouette
chunky? do textures resolve at 320×240? is anything mushy or over-smooth?
Parts flagged by structural issues get automatic close-up cells (orange
border, rendered clean without dither) appended to the sheet — never ignore them.

## Mandatory verification protocol (learned the hard way)

Full-model views hide local errors: a lamp was once shipped "looking right"
while its shade was attached by the rim to the arm, with the joint floating in
front of the bulb. Before declaring any model done:

1. **Zero `[warn]`/`[error]` issues.** Structural errors (TENUOUS ATTACHMENT,
   FLOATING ASSEMBLY, NON-STRUCTURAL SUPPORT, INVISIBLE PART) and PSX errors
   (POLY BUDGET EXCEEDED, PBR materials, oversized textures) are never
   acceptable.
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
   stacked joint strong, overlap the sections a FEW MILLIMETRES so the two
   large faces sit near-coplanar — e.g. a cabinet section whose bottom face
   is 8mm below the top face of the section beneath it (see models/psx-arcade.js).
   Concretely: **aim for ~8mm face separation on a ~1.5m model** — 12-15mm sits
   at the tolerance edge and flakes between runs. And since strength ≈ contact
   area / the part's TOTAL surface, long thin parts (arms, columns) need a
   proportionally larger overlap band than squat ones to clear the 0.13 bar.

## Commands

```
node bin/agentforge.mjs new <name>              scaffold a new model
node bin/agentforge.mjs render <name>           PSX render → renders/<name>/
    --focus <ObjectName>                        close-up framed on one named part
    --isolate                                   (with --focus) hide everything else
    --views persp,front,top,...                 subset of: persp persp2 front back right left top bottom wire
    --turntable                                 add 8 rotating views (views/turn0..7.png)
    --size 1280x960                             output size (default 960x720 = 3× PSX framebuffer)
    --psx-res 512x240                           internal framebuffer (default 320x240; also authentic: 256x240, 640x480)
    --hd                                        disable the PSX pipeline (clean PBR studio, geometry debugging ONLY)
    --no-sheet                                  skip contact sheet (faster for quick checks)
node bin/agentforge.mjs inspect <name>          full JSON report only, no images (fastest)
node bin/agentforge.mjs export <name>           → exports/<name>.glb
node bin/agentforge.mjs dev                     live PSX viewer at http://127.0.0.1:4747 (hot reload, X toggles FX)
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
- Judging raw geometry (joints, interpenetration): add `--hd` — dither hides
  small defects. Judging the LOOK: never use `--hd` (exception: models with
  `psx.enabled: false`, which are HD by design).
- HD mode (`--hd` or `psx.enabled: false`) applies ACES tone mapping, which
  desaturates ~15%: pre-saturate material colors to land on the intended tone
  (see models/tiny-theft-man.js).
- `report.json` / `inspect` give exact world positions and sizes of every named
  part — use them to compute joint positions instead of guessing.

## Model file contract (`models/<name>.js`)

```js
import * as THREE from 'three';                    // full three.js available
// import { X } from 'three/addons/...';          // all three.js addons available

export const meta = {
  name, description, units: 'meters',
  psx: {
    budget: 800,              // triangle budget (default 1500) — enforced
    // resolution: [320, 240],  // framebuffer override
    // dither: true, snap: true, affine: true, enabled: true,  // pipeline toggles
  },
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
  be portable — no Portuguese, no `""`, no two different materials sharing a
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
- **Use `mats` presets; never PBR.** `mats.unlit` is legitimate (screens, signs).

## Available context

`mats.*` — flat-shaded PS1 materials (each returns a fresh instance; last arg =
param overrides, e.g. `mats.plastic(0xffffff, { map: tex.checker() })`):
plastic(color), glossyPlastic(color), matte(color), rubber(color),
metal(color, rough), chrome(), brushedMetal(color), gold(), brass(), copper(),
paintedMetal(color), glass(color), frostedGlass(color), ceramic(color),
wood(color), darkWood(), fabric(color), skin(color),
emissive(color, intensity), unlit(colorOrWhite, {map}), vertexColor(),
textured(map), custom({any MeshPhongMaterial params})
- **Every lit preset ships with photographic grain by default** (grayscale
  map multiplied under the color: speckle on plastics, wear streaks on
  metals, real grain on woods, blotches on matte/fabric). Override with your
  own `{ map: tex.wood(...) }`, or force a clean fill with `{ map: null }`
  (rarely right — flat fills read as cartoon).
- Pass `{ flatShading: false }` for smooth gouraud shading on organic shapes.
- glass/frostedGlass are alpha-blended (PS1 semi-transparency) and count as
  non-structural, like emissive — never make them the only mount.

`tex.*` — procedural low-res textures (64px default, NearestFilter, no mips,
seeded/deterministic), tuned to read as DIGITIZED PHOTOS: fractal tone
variation, grime and wear are baked in by default. PS1 textures were ≤128px;
>256px is flagged:
- Photographic surfaces: `tex.wood(base, {planks, horizontal})` (grain streaks,
  knots, plank seams), `tex.concrete(base)`, `tex.metalWorn(base)`,
  `tex.noise(base, {amount})` (fractal tone), `tex.grunge(base, {amount})`
  (heavy stains — great multiplied over a color as dirt).
- Patterns (grime baked in; `dirty: 0` for clean): `tex.checker(c1, c2, {cells})`,
  `tex.grid(bg, line)`, `tex.stripes([colors])`, `tex.bricks(brick, mortar)`.
- `tex.gradient(top, bottom)` — clean vertical gradient (skies, glows).
- `tex.pixel([rows], palette)` — **pixel art from strings**, one char per texel
  (`'.'`/`' '` = transparent). Screens, signs, decals ONLY — never a surface.
  See models/psx-arcade.js for a screen and a marquee.
- `tex.canvas(size, (ctx, w, h) => {...})` — raw 2D-canvas escape hatch.
- Textures tile: `t.repeat.set(4, 2)` on the returned texture.

`helpers.*` (aliased `H`):
- `group(name, ...children)` / `mesh(name, geo, mat, {pos:[x,y,z], rot:[rx,ry,rz], scale})`
- `place(obj, [x,y,z], {rot, scale})` — terse transform, returns obj
- **Primitives** (segment defaults are already PSX-appropriate — don't raise
  them casually): `box(w,h,d)` (12 tris), `roundedBox(w,h,d,r?)` (chamfered),
  `cylinder(rTop, rBottom, h, seg=12)` / `cone(r, h, seg=8)` / `capsule(r, h)`
  (base at y=0), `sphere(r, 10, 7)`, `icosphere(r, detail)` (20/80/320 tris),
  `lathe([[radius, y], ...], seg=16)`, `tube([[x,y,z], ...], radius)`
- **PSX tools**: `facet(geo)` — hard per-face normals (also bakes into GLB);
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
  - root: `userData.units='meters'` (glTF is metres by spec — 1 unit = 1 m),
    `up='+y'`, `front='+z'`.
  - articulated parts: `userData.kind`, `openAxis`, `travel` (metres of motion),
    `closedZ`, so the engine animates without reverse-engineering the rig.
  - `H.marker(...)` for item slots / hardpoints / snap points — an empty node
    the engine positions objects against.
- **Rest pose** — model closed/neutral (see the rest-pose rule above), so the
  received asset is the canonical state.

The PSX screen effects (dither, 320×240, vertex jitter, affine warp) are
*render-time* only — they are NOT baked into the GLB. The model is inherently
retro (low-poly + nearest textures); for the full PS1 look in-engine, the
integrator adds a PSX shader on their side.

## Reading the render output

`render` prints: dimensions, triangle/mesh counts, **PSX budget usage**,
materials, **assembly interfaces**, **issues**, and the full structure tree
with world position + size of every part. `renders/<name>/report.json`
additionally contains:

- `psx` — budget, triangles, pctOfBudget, withinBudget, pipeline settings
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

PSX ones: **POLY BUDGET EXCEEDED** (simplify the flagged heavy meshes first),
**PBR materials** (switch to mats presets), **oversized textures** (use tex.*).
Others: not grounded, wrong scale for meters, unnamed meshes, degenerate geometry.

## Reference models

- `models/psx-arcade.js` — the showcase: box modeling, chamfers, tex.pixel
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
- `models/example-lamp.js`, `models/swiss-cheese.js` — legacy pre-PSX models
  (over budget by design); swiss-cheese documents the CSG-clean-base technique.

## Architecture (for maintaining the tool itself)

- `bin/agentforge.mjs` — CLI dispatch
- `src/server.mjs` — static server + SSE hot reload + screenshot API
- `src/capture.mjs` — puppeteer-core orchestration (uses local Chrome/Edge, no download)
- `web/headless.{html,js}` — capture page: renders views, composes sheet, exports GLB
- `web/viewer.{html,js}` — live PSX viewer (OrbitControls, data panel, hot reload,
  PSX toggle)
- `web/common/` — shared:
  - `psx.js` — **the PS1 pipeline**: PSXPost (320×240 target, RGB555 quantize +
    Bayer dither, nearest upscale) and material patching (vertex snap + affine
    UVs via onBeforeCompile, toggleable per-view through shared uniforms)
  - `textures.js` — the `tex.*` procedural texture toolkit
  - `materials.js` — flat-shaded Lambert/Phong presets (no PBR)
  - `stage.js` — PSX stage (simple lights, checker floor, blob shadow, fog) +
    legacy HD studio for `--hd`
  - `helpers.js` — geometry helpers + PSX tools (facet, quantizeVerts, vertexPaint)
  - `analyze.js` — report generator + budget/PBR/texture checks
  - `contacts.js` — BVH contact graph (floating/tenuous/non-structural checks)
  - `visibility.js` — per-part ID-pass pixel coverage (swallowed/hidden parts;
    runs before material patching, unaffected by the PSX pipeline)
- Headless WebGL runs on SwiftShader (`--enable-unsafe-swiftshader`); browser
  located by `src/browser-finder.mjs`, overridable via `AGENTFORGE_BROWSER` env var.
- Diagnostic renders (wireframe view, issue close-ups) bypass the PSX post so
  defects stay crisp; beauty views always go through it.
