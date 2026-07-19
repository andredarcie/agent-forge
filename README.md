# ⚒ AgentForge

**A native 3D modeling environment for AI agents, built on Three.js.**

An AI agent (Claude Code, etc.) writes 3D models as JavaScript code, renders
them in seconds without opening a single window, **sees** the result (a
multi-view contact sheet as a PNG), receives a rich data report about the scene
and keeps iterating — the same loop a 3D artist uses: model → look → refine.

<p align="center"><em>model as code → headless render → sheet.png + report.json → iterate</em></p>

## Why this works well for AI

1. **Fast visualization** — `render` produces a contact sheet with 8 views in ~5 s
   (2 perspective, 5 orthographic, wireframe) + a data card. The agent reads a single
   PNG and sees the model from every angle.
2. **Screenshots on demand** — `--focus <Part>` frames any named part for
   close-ups; `--turntable` generates 8 rotating views; the live viewer saves
   screenshots with a keypress.
3. **Lots of data** — every render produces `report.json`: real dimensions in meters,
   a hierarchical tree with each part's world position/size/orientation, triangle
   count, materials, a **contact graph** (real surface-to-surface distance between
   every pair of parts, via BVH), **assembly interfaces** (where each assembly
   attaches to the rest) and **per-part visibility** (pixels visible across 8 views).
4. **Automatic structural error detection** — floating assemblies, parts held
   only by a grazing contact, assemblies supported by emissive/glass parts,
   swallowed/invisible parts, model off the ground, wrong scale, unnamed meshes,
   degenerate geometry... Flagged parts get **automatic close-ups** on the
   contact sheet.
5. **Quality by default** — PBR lighting studio (key/fill/rim + environment),
   ACES tone mapping, soft shadows, and a library of ~20 ready-made physical
   materials (brushed metal, brass, glass, ceramic, rubber...).

## Installation

```bash
npm install        # three + puppeteer-core (uses your installed Chrome/Edge)
```

Requirements: Node 18+, Google Chrome or Microsoft Edge installed
(or set `AGENTFORGE_BROWSER` to the path of a Chromium build).

## Usage

```bash
node bin/agentforge.mjs new robot           # creates models/robot.js from the template
# ... edit models/robot.js ...
node bin/agentforge.mjs render robot        # renders → renders/robot/sheet.png + report.json
node bin/agentforge.mjs dev                 # live viewer: http://127.0.0.1:4747 (hot reload)
node bin/agentforge.mjs export robot        # exports exports/robot.glb (industry standard)
```

Useful `render` flags:

| Flag | Effect |
|---|---|
| `--focus Head` | close-up framed on the part named "Head" |
| `--isolate` | with `--focus`: hides the rest of the model |
| `--views persp,front,top` | only the requested views (faster) |
| `--turntable` | +8 views rotating around the model |
| `--size 1600x1200` | higher resolution |
| `--json` | prints the full report to stdout |

Available views: `persp persp2 front back right left top bottom wire`.

## Writing a model

Models are ES modules in `models/*.js`. Units in **meters**, Y up, model
resting on the ground (y=0):

```js
import * as THREE from 'three';

export const meta = { name: 'mug', description: 'Coffee mug', units: 'meters' };

export function build({ THREE, mats, helpers: H }) {
  const root = H.group('Mug');

  root.add(
    H.mesh('Body', H.lathe([
      [0.000, 0.000], [0.040, 0.000], [0.042, 0.004],
      [0.042, 0.095], [0.040, 0.098], [0.037, 0.095], [0.037, 0.008], [0.000, 0.008],
    ]), mats.ceramic(0xf3efe8)),
    H.mesh('Handle', H.tube([
      [0.042, 0.075, 0], [0.068, 0.065, 0], [0.070, 0.040, 0], [0.045, 0.028, 0],
    ], 0.006), mats.ceramic(0xf3efe8)),
  );

  return H.centerGround(root);   // centers and rests it on the ground
}
```

The context provides:
- **`mats`** — PBR presets: `plastic, glossyPlastic, matte, rubber, metal, chrome,
  brushedMetal, gold, brass, copper, paintedMetal, glass, frostedGlass, ceramic,
  wood, darkWood, fabric, skin, emissive, custom`
- **`helpers`** — `group, mesh, place, roundedBox, lathe, tube, cylinder, capsule,
  radialClone, mirrorX, measure, centerGround`, and for safe assembly across
  rotated frames: `snap(child, localPoint, target, targetLocalPoint)` (welds by
  coinciding anchor points), `worldPos(obj)`, `dist(a, b)`
- Any import from `three` and `three/addons/*` also works directly in the model.

The complete workflow guide for agents is in [`CLAUDE.md`](CLAUDE.md).

## Structure

```
bin/agentforge.mjs     CLI
src/                   server, headless capture (puppeteer-core), template
web/                   live viewer + capture page + shared libs
web/common/            stage (lights/cameras), materials, helpers, analyze, loader
models/                your models (example-lamp.js included)
renders/               output: sheet.png, views/*.png, report.json
exports/               GLB output
```
