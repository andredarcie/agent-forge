// Model: dresser — PSX wooden dresser with 3 sliding drawers.
//
// Integration conventions (so the .glb ships ready to use):
//  - Node and material names in English PascalCase (they become glTF node
//    names and --focus targets).
//  - NEUTRAL pose = everything closed. To open, adjust OPEN below (0 = closed,
//    up to ~0.30 m = full travel) and re-render. At runtime each drawer is a
//    named group (DrawerTop/DrawerMiddle/DrawerBottom): move the group in +Z.
//  - Each drawer carries metadata (userData -> glTF `extras`): openAxis,
//    travel and an empty ItemSlot* node marking where an item rests inside it.
//    The root declares units (meters), up axis (+Y) and front (+Z).
import * as THREE from 'three';

const OPEN = {
  bottom: 0,
  middle: 0, // neutral pose: closed. e.g. middle: 0.25 opens the middle drawer
  top: 0,
};

const TRAVEL = 0.30; // maximum opening travel (m) before leaving the runner

export const meta = {
  name: 'dresser',
  description: 'Wooden dresser with 3 drawers that open and close (groups sliding on the +Z axis)',
  units: 'meters',
  psx: { budget: 600 },
};

export function build({ THREE, mats, helpers: H, tex }) {
  const root = H.group('Dresser');
  // Asset metadata -> glTF `extras` (GLTFLoader exposes it on userData).
  root.userData.units = 'meters'; // 1 unit = 1 meter (glTF standard)
  root.userData.up = '+y';
  root.userData.front = '+z';

  // Shared materials — unique, descriptive names (one per tone).
  const woodCarcass = mats.textured(tex.wood(0x8a5a2b, { planks: 4 }), { name: 'WoodCarcass' });
  const woodFront = mats.textured(tex.wood(0xa87840, { planks: 1, seed: 5, horizontal: true }), { name: 'WoodFront' });
  const woodDark = mats.darkWood({ name: 'WoodDark' });
  const woodRaw = mats.wood(0xd8c49a, { name: 'WoodRaw' }); // drawer interiors, raw wood

  // --- Legs (0..0.10; the base panel overlaps them by 8mm) ------------------
  for (const [sx, sz, nm] of [[-1, 1, 'LegFrontLeft'], [1, 1, 'LegFrontRight'], [-1, -1, 'LegBackLeft'], [1, -1, 'LegBackRight']]) {
    root.add(H.mesh(nm, H.box(0.06, 0.10, 0.06), woodDark, { pos: [sx * 0.35, 0.05, sz * 0.19] }));
  }

  // --- Carcass ----------------------------------------------------------------
  // PSX joint rule: large parallel faces ~8mm apart = strong structural
  // contact. Each panel overlaps its neighbor by 8mm.
  root.add(H.mesh('Base', H.box(0.80, 0.04, 0.48), woodCarcass, { pos: [0, 0.112, 0] }));            // 0.092..0.132
  root.add(H.mesh('SideLeft', H.box(0.04, 0.76, 0.48), woodCarcass, { pos: [-0.38, 0.504, 0] }));    // 0.124..0.884
  root.add(H.mesh('SideRight', H.box(0.04, 0.76, 0.48), woodCarcass, { pos: [0.38, 0.504, 0] }));
  root.add(H.mesh('BackPanel', H.box(0.80, 0.76, 0.025), woodCarcass, { pos: [0, 0.504, -0.2275] }));
  root.add(H.mesh('TopBoard', H.box(0.84, 0.05, 0.51), woodDark, { pos: [0, 0.901, 0.015] }));       // 0.876..0.926

  // Top-board fixing cleats: each block has its vertical face 3mm from the
  // inner face of the side panel and its top face 3mm from the underside of
  // the top board — two strong links tying the top to the carcass.
  for (const [sx, nm] of [[-1, 'TopCleatLeft'], [1, 'TopCleatRight']]) {
    const cleat = H.mesh(nm, H.box(0.04, 0.06, 0.44), woodDark, { pos: [sx * 0.337, 0.843, 0] });
    cleat.userData.interior = true;
    root.add(cleat);
  }

  // Structural battens at the back (behind the drawers): perpendicular panels
  // do not bind strongly to each other, so a square-section batten makes each
  // joint — two of its faces sit 3mm from two different pieces:
  //   BottomBrace:  base <-> back panel
  //   BackPost*:    back panel <-> side panel
  const brace = H.mesh('BottomBrace', H.box(0.60, 0.05, 0.05), woodDark, {
    pos: [0, 0.160, -0.187], // 3mm above the base, 3mm in front of the back panel
  });
  brace.userData.interior = true;
  root.add(brace);
  for (const [sx, nm] of [[-1, 'BackPostLeft'], [1, 'BackPostRight']]) {
    const post = H.mesh(nm, H.box(0.05, 0.55, 0.05), woodDark, {
      pos: [sx * 0.332, 0.475, -0.187], // 3mm from the side, 3mm from the back
    });
    post.userData.interior = true;
    root.add(post);
  }

  // Runner frames between the drawers: the horizontal rail (which the drawer
  // slides on) joined via CSG to two vertical side guides in a single piece.
  // The guides have their large face 3mm from the inner face of each side
  // panel — that link (large parallel faces) is what holds the frame to the
  // carcass.
  function runnerFrame(nm, yRail, yRibBottom) {
    const rail = H.mesh(nm, H.box(0.714, 0.03, 0.45), woodCarcass, { pos: [0, yRail, 0.015] });
    const ribs = [-1, 1].map((sx) =>
      H.mesh('RunnerGuide', H.box(0.012, yRail - 0.015 + 0.005 - yRibBottom, 0.45), woodCarcass, {
        pos: [sx * 0.351, (yRibBottom + yRail - 0.015 + 0.005) / 2, 0.015],
      })
    );
    const frame = H.union(rail, ...ribs);
    frame.userData.interior = true;
    return frame;
  }
  root.add(runnerFrame('RunnerLower', 0.375, 0.135)); // guides reach down to 3mm from the base
  root.add(runnerFrame('RunnerUpper', 0.633, 0.393)); // guides down to 3mm from the lower rail

  // --- Drawers ----------------------------------------------------------------
  // makeDrawer builds a drawer with the opening's floor at `ob` (opening
  // height: 0.228). The group sits at the origin; translating it in +Z opens
  // the drawer.
  function makeDrawer(name, suffix, ob, open) {
    const g = H.group(name);
    const yc = ob + 0.114; // vertical center of the opening

    // Overlay front: sits flat against the carcass front plane (z=0.24)
    g.add(H.mesh(`Front${suffix}`, H.box(0.76, 0.222, 0.025), woodFront, { pos: [0, yc, 0.2525] }));
    g.add(H.mesh(`Handle${suffix}`, H.box(0.12, 0.026, 0.045), woodDark, { pos: [0, yc, 0.265] }));

    // Tray: ONE single piece (CSG box - cavity) — no thin internal joints,
    // which the contact analysis always reads as fragile. The bottom sits 3mm
    // above the rail and the walls 5mm from the carcass sides (close parallel
    // faces = support), and the front wall penetrates 5mm into the back of the
    // drawer front.
    const trayBase = H.mesh(`Tray${suffix}`, H.box(0.68, 0.145, 0.40), woodRaw, {
      pos: [0, ob + 0.0755, 0.045], // 10mm clearance for the side guides
    });
    const cavity = H.mesh('Cavity', H.box(0.65, 0.14, 0.37), woodRaw, {
      pos: [0, ob + 0.088, 0.045], // bottom 15mm; cut top 10mm above the rim (never coplanar)
    });
    const tray = H.subtract(trayBase, cavity);
    tray.userData.interior = true; // inside the carcass when closed
    g.add(tray);

    // Empty node marking the item slot (cavity floor, centered). The engine
    // reads the position to seat an object without guessing by bounding box.
    g.add(H.marker(`ItemSlot${suffix}`, { pos: [0, ob + 0.02, 0.045], data: { slot: 'item' } }));

    // Articulation metadata -> glTF `extras`: opening axis and travel.
    g.userData.kind = 'drawer';
    g.userData.openAxis = '+z';
    g.userData.travel = TRAVEL;
    g.userData.closedZ = 0;

    g.position.z = open; // 0 = closed (neutral pose); +Z opens
    return g;
  }

  root.add(makeDrawer('DrawerBottom', 'Bottom', 0.132, OPEN.bottom));
  root.add(makeDrawer('DrawerMiddle', 'Middle', 0.390, OPEN.middle));
  root.add(makeDrawer('DrawerTop', 'Top', 0.648, OPEN.top));

  return H.centerGround(root);
}
