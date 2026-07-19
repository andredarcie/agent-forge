// Model: arcade-cabinet — a 90s upright arcade cabinet, the showcase piece.
// Demonstrates the whole toolkit: box modeling, chamfered edges, pixel-art
// textures (tex.pixel) for the screen and marquee, unlit and emissive used
// correctly, vertex-painted shading, low-seg cylinders, and a triangle budget
// with room to spare.
import * as THREE from 'three';

export const meta = {
  name: 'arcade-cabinet',
  description: 'Classic upright arcade cabinet with pixel-art screen and marquee',
  units: 'meters',
  budget: 800,
};

export function build({ THREE, mats, helpers: H, tex }) {
  const root = H.group('ArcadeCabinet');

  const bodyBlue = 0x2b3a8c;

  // --- Cabinet stack ---------------------------------------------------------
  // Joint rule for big stacked boxes: overlap the sections a few millimeters
  // so the large horizontal faces sit CLOSE AND PARALLEL (within the contact
  // tolerance). That is what registers as a strong structural interface —
  // burying a box deep inside another only creates a thin crossing ring.
  const kick = H.mesh('KickBase', H.box(0.58, 0.088, 0.68), mats.rubber(0x16161e), {
    pos: [0, 0.044, 0], // top face 8mm above the body's bottom face
  });

  const body = H.mesh('Body', H.roundedBox(0.62, 0.87, 0.72, 0.012), mats.plastic(bodyBlue), {
    pos: [0, 0.08 + 0.435, 0],
  });
  // fake AO: darker toward the floor — the cheapest way to shade a big flat panel
  H.vertexPaint(body, ([, y]) => {
    const t = Math.min(Math.max((y + 0.435) / 0.87, 0), 1); // 0 bottom .. 1 top
    const v = Math.round((0.55 + 0.45 * t) * 255);
    return (v << 16) | (v << 8) | v;
  });

  const tower = H.mesh('ScreenTower', H.roundedBox(0.62, 0.62, 0.55, 0.012), mats.plastic(bodyBlue), {
    pos: [0, 0.942 + 0.31, -0.08], // bottom face 8mm below the body's top face
  });
  H.vertexPaint(tower, ([, y]) => {
    const t = Math.min(Math.max((y + 0.31) / 0.62, 0), 1);
    const v = Math.round((0.72 + 0.28 * t) * 255);
    return (v << 16) | (v << 8) | v;
  });

  const marquee = H.mesh('Marquee', H.box(0.64, 0.18, 0.50), mats.plastic(0x1c1c28), {
    pos: [0, 1.644, -0.08], // bottom face 8mm below the tower's top face
  });

  root.add(kick, body, tower, marquee);

  // --- Marquee face: back-lit "ARCADE" pixel sign ---------------------------
  // 3x5 letters separated by one background column; tex.pixel is always
  // nearest-filtered, so the texels stay square at any render size.
  const marqueeTex = tex.pixel([
    'mmmmmmmmmmmmmmmmmmmmmmmmm',
    'mYYYmYYYmYYYmYYYmYYmmYYYm',
    'mYmYmYmYmYmmmYmYmYmYmYmmm',
    'mYYYmYYYmYmmmYYYmYmYmYYYm',
    'mYmYmYYmmYmmmYmYmYmYmYmmm',
    'mYmYmYmYmYYYmYmYmYYmmYYYm',
    'mmmmmmmmmmmmmmmmmmmmmmmmm',
  ], { m: 0x3a1050, Y: 0xffd23c });
  // Thin sign panel: keep it nearly flush with the marquee front — a thick
  // proud box would show the texture squished on its edge faces from the side.
  const marqueeFace = H.mesh('MarqueeFace', H.box(0.56, 0.13, 0.024), mats.unlit(0xffffff, { map: marqueeTex }), {
    pos: [0, 1.644, 0.161], // spans 0.149..0.173: 3mm proud, 21mm embedded
  });
  root.add(marqueeFace);

  // --- Screen: bezel + pixel-art game frame ---------------------------------
  const bezel = H.mesh('ScreenBezel', H.box(0.52, 0.42, 0.05), mats.matte(0x14141c), {
    pos: [0, 1.25, 0.195],
  });
  // a tiny shmup scene, drawn texel by texel
  const screenTex = tex.pixel([
    'KKKKKKKKKKKKKKKKKKKK',
    'KWKKKKRKRKRKRKKKKWKK',
    'KKKKKKKRKRKRKKKKKKKK',
    'KKKKKRKRKRKRKRKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKWKKKKKKKKKKKKKWKKK',
    'KKKKKKKKKYKKKKKKKKKK',
    'KKKKKKKKKYKKKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'KKKKKKKKKGKKKKKKKKKK',
    'KKKKKKKKGGGKKKKKKKKK',
    'KKKKKKKGGGGGKKKKKKKK',
    'KKKKKKKKKKKKKKKKKKKK',
    'WWWWKKKKKKKKKKKWWWWK',
    'KKKKKKKKKKKKKKKKKKKK',
  ], { K: 0x101024, W: 0xd8d8e8, R: 0xd94040, G: 0x40c860, Y: 0xffd23c });
  const screen = H.mesh('Screen', H.box(0.42, 0.32, 0.02), mats.unlit(0xffffff, { map: screenTex }), {
    pos: [0, 1.25, 0.212], // 2mm proud of the bezel, well overlapped behind it
  });
  root.add(bezel, screen);

  // --- Control deck ----------------------------------------------------------
  const deck = H.mesh('ControlDeck', H.roundedBox(0.62, 0.07, 0.32, 0.008), mats.plastic(0x1c1c28), {
    pos: [0, 0.977, 0.34], // bottom face 8mm below the body's top face
  });
  root.add(deck);

  const joystick = H.group('Joystick');
  joystick.position.set(-0.16, 1.005, 0.36); // base sunk 7mm into the deck top
  joystick.add(
    H.mesh('JoyBase', H.cylinder(0.032, 0.038, 0.014, 10), mats.matte(0x16161e)),
    H.mesh('JoyShaft', H.cylinder(0.007, 0.007, 0.075, 8), mats.metal(0xb8bcc4, 0.3), { pos: [0, 0.008, 0] }),
    H.mesh('JoyBall', H.sphere(0.022, 10, 7), mats.glossyPlastic(0xd93030), { pos: [0, 0.09, 0] })
  );
  root.add(joystick);

  const btnA = H.mesh('ButtonA', H.cylinder(0.019, 0.019, 0.016, 10), mats.glossyPlastic(0xd93030), {
    pos: [0.08, 1.004, 0.33],
  });
  const btnB = H.mesh('ButtonB', H.cylinder(0.019, 0.019, 0.016, 10), mats.glossyPlastic(0xffd23c), {
    pos: [0.16, 1.004, 0.38],
  });
  root.add(btnA, btnB);

  // --- Coin door --------------------------------------------------------------
  const coinDoor = H.mesh('CoinDoor', H.box(0.16, 0.22, 0.03), mats.metal(0x8a8e96, 0.4), {
    pos: [0, 0.42, 0.36],
  });
  const coinSlot = H.mesh('CoinSlot', H.box(0.03, 0.06, 0.01), mats.matte(0x101014), {
    pos: [0, 0.46, 0.373],
  });
  root.add(coinDoor, coinSlot);

  return H.centerGround(root);
}
