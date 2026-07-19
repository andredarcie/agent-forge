// Model: armario-gavetas — cômoda de madeira PSX com 3 gavetas deslizantes.
//
// Convenções de integração (para o .glb sair pronto pra usar):
//  - Nomes de nós e materiais em inglês PascalCase (viram nomes de nó no glTF
//    e alvos de --focus).
//  - Pose NEUTRA = tudo fechado. Para abrir, ajuste OPEN abaixo (0 = fechada,
//    até ~0.30 m = curso máximo) e re-renderize. Em runtime, cada gaveta é um
//    grupo nomeado (DrawerTop/DrawerMiddle/DrawerBottom): mova o grupo em +Z.
//  - Cada gaveta carrega metadados (userData -> glTF `extras`): openAxis,
//    travel e um nó vazio ItemSlot* marcando onde um item repousa dentro dela.
//    A raiz declara unidades (metros), eixo up (+Y) e frente (+Z).
import * as THREE from 'three';

const OPEN = {
  bottom: 0,
  middle: 0, // pose neutra: fechada. ex.: middle: 0.25 abre a gaveta do meio
  top: 0,
};

const TRAVEL = 0.30; // curso máximo de abertura (m) antes de sair do trilho

export const meta = {
  name: 'armario-gavetas',
  description: 'Cômoda de madeira com 3 gavetas que abrem e fecham (grupos deslizantes no eixo +Z)',
  units: 'meters',
  psx: { budget: 600 },
};

export function build({ THREE, mats, helpers: H, tex }) {
  const root = H.group('Dresser');
  // Metadados de asset -> glTF `extras` (o GLTFLoader expõe em userData).
  root.userData.units = 'meters'; // 1 unidade = 1 metro (padrão glTF)
  root.userData.up = '+y';
  root.userData.front = '+z';

  // Materiais compartilhados — nomes únicos e descritivos (um por tom).
  const woodCarcass = mats.textured(tex.wood(0x8a5a2b, { planks: 4 }), { name: 'WoodCarcass' });
  const woodFront = mats.textured(tex.wood(0xa87840, { planks: 1, seed: 5, horizontal: true }), { name: 'WoodFront' });
  const woodDark = mats.darkWood({ name: 'WoodDark' });
  const woodRaw = mats.wood(0xd8c49a, { name: 'WoodRaw' }); // interior das gavetas, madeira crua

  // --- Pernas (0..0.10; o painel de base morde 8mm nelas) -------------------
  for (const [sx, sz, nm] of [[-1, 1, 'LegFrontLeft'], [1, 1, 'LegFrontRight'], [-1, -1, 'LegBackLeft'], [1, -1, 'LegBackRight']]) {
    root.add(H.mesh(nm, H.box(0.06, 0.10, 0.06), woodDark, { pos: [sx * 0.35, 0.05, sz * 0.19] }));
  }

  // --- Carcaça ----------------------------------------------------------------
  // Regra de junta PSX: faces grandes paralelas a ~8mm uma da outra = contato
  // estrutural forte. Cada painel morde 8mm no vizinho.
  root.add(H.mesh('Base', H.box(0.80, 0.04, 0.48), woodCarcass, { pos: [0, 0.112, 0] }));            // 0.092..0.132
  root.add(H.mesh('SideLeft', H.box(0.04, 0.76, 0.48), woodCarcass, { pos: [-0.38, 0.504, 0] }));    // 0.124..0.884
  root.add(H.mesh('SideRight', H.box(0.04, 0.76, 0.48), woodCarcass, { pos: [0.38, 0.504, 0] }));
  root.add(H.mesh('BackPanel', H.box(0.80, 0.76, 0.025), woodCarcass, { pos: [0, 0.504, -0.2275] }));
  root.add(H.mesh('TopBoard', H.box(0.84, 0.05, 0.51), woodDark, { pos: [0, 0.901, 0.015] }));       // 0.876..0.926

  // Sarrafos de fixação do tampo: cada bloco tem a face vertical a 3mm da face
  // interna da lateral e a face superior a 3mm da face inferior do tampo —
  // duas ligações fortes que amarram o tampo à carcaça.
  for (const [sx, nm] of [[-1, 'TopCleatLeft'], [1, 'TopCleatRight']]) {
    const cleat = H.mesh(nm, H.box(0.04, 0.06, 0.44), woodDark, { pos: [sx * 0.337, 0.843, 0] });
    cleat.userData.interior = true;
    root.add(cleat);
  }

  // Sarrafos estruturais no fundo (atrás das gavetas): painéis perpendiculares
  // não se ligam forte entre si, então um sarrafo de seção quadrada faz cada
  // junta — duas de suas faces ficam a 3mm de duas peças diferentes:
  //   BottomBrace:  base <-> painel traseiro
  //   BackPost*:    painel traseiro <-> lateral
  const brace = H.mesh('BottomBrace', H.box(0.60, 0.05, 0.05), woodDark, {
    pos: [0, 0.160, -0.187], // 3mm acima da base, 3mm à frente do traseiro
  });
  brace.userData.interior = true;
  root.add(brace);
  for (const [sx, nm] of [[-1, 'BackPostLeft'], [1, 'BackPostRight']]) {
    const post = H.mesh(nm, H.box(0.05, 0.55, 0.05), woodDark, {
      pos: [sx * 0.332, 0.475, -0.187], // 3mm da lateral, 3mm do traseiro
    });
    post.userData.interior = true;
    root.add(post);
  }

  // Quadros de trilho entre as gavetas: o trilho horizontal (onde a gaveta
  // desliza) unido via CSG a duas guias laterais verticais numa peça só. As
  // guias têm a face grande a 3mm da face interna de cada lateral — é essa
  // ligação (faces grandes paralelas) que prende o quadro à carcaça.
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
  root.add(runnerFrame('RunnerLower', 0.375, 0.135)); // guias descem até 3mm da base
  root.add(runnerFrame('RunnerUpper', 0.633, 0.393)); // guias até 3mm do trilho de baixo

  // --- Gavetas ----------------------------------------------------------------
  // makeDrawer constrói uma gaveta com a base da abertura em `ob` (altura da
  // abertura: 0.228). O grupo fica na origem; transladar em +Z abre a gaveta.
  function makeDrawer(name, suffix, ob, open) {
    const g = H.group(name);
    const yc = ob + 0.114; // centro vertical da abertura

    // Frente sobreposta: encosta plana no plano frontal da carcaça (z=0.24)
    g.add(H.mesh(`Front${suffix}`, H.box(0.76, 0.222, 0.025), woodFront, { pos: [0, yc, 0.2525] }));
    g.add(H.mesh(`Handle${suffix}`, H.box(0.12, 0.026, 0.045), woodDark, { pos: [0, yc, 0.265] }));

    // Bandeja: UMA peça só (CSG caixa - cavidade) — sem juntas internas finas,
    // que a análise de contato sempre lê como frágeis. O fundo fica 3mm acima
    // do trilho e as paredes a 5mm das laterais da carcaça (faces paralelas
    // próximas = apoio), e a parede frontal penetra 5mm no verso da frente.
    const trayBase = H.mesh(`Tray${suffix}`, H.box(0.68, 0.145, 0.40), woodRaw, {
      pos: [0, ob + 0.0755, 0.045], // 10mm de folga para as guias laterais
    });
    const cavity = H.mesh('Cavity', H.box(0.65, 0.14, 0.37), woodRaw, {
      pos: [0, ob + 0.088, 0.045], // fundo 15mm; topo do corte 10mm acima da borda (nunca coplanar)
    });
    const tray = H.subtract(trayBase, cavity);
    tray.userData.interior = true; // dentro da carcaça quando fechada
    g.add(tray);

    // Nó vazio marcando o slot do item (piso da cavidade, centrado). O engine
    // lê a posição pra encaixar um objeto sem adivinhar por bounding-box.
    g.add(H.marker(`ItemSlot${suffix}`, { pos: [0, ob + 0.02, 0.045], data: { slot: 'item' } }));

    // Metadados de articulação -> glTF `extras`: eixo e curso de abertura.
    g.userData.kind = 'drawer';
    g.userData.openAxis = '+z';
    g.userData.travel = TRAVEL;
    g.userData.closedZ = 0;

    g.position.z = open; // 0 = fechada (pose neutra); +Z abre
    return g;
  }

  root.add(makeDrawer('DrawerBottom', 'Bottom', 0.132, OPEN.bottom));
  root.add(makeDrawer('DrawerMiddle', 'Middle', 0.390, OPEN.middle));
  root.add(makeDrawer('DrawerTop', 'Top', 0.648, OPEN.top));

  return H.centerGround(root);
}
