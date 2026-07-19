# ⚒ AgentForge

**Ambiente de modelagem 3D nativo para agentes de IA, construído sobre Three.js.**

Um agente de IA (Claude Code, etc.) escreve modelos 3D como código JavaScript,
renderiza-os em segundos sem abrir janela nenhuma, **vê** o resultado (folha de
contato multi-vista em PNG), recebe um relatório rico de dados sobre a cena e
continua iterando — o mesmo loop de um artista 3D: modelar → olhar → refinar.

<p align="center"><em>modelo em código → render headless → sheet.png + report.json → iterar</em></p>

## Por que isso funciona bem para IA

1. **Visualização rápida** — `render` gera em ~5 s uma folha de contato com 8 vistas
   (2 perspectivas, 5 ortográficas, wireframe) + card de dados. O agente lê um único
   PNG e enxerga o modelo de todos os ângulos.
2. **Prints sob demanda** — `--focus <Peça>` enquadra qualquer parte nomeada para
   close-ups; `--turntable` gera 8 vistas em rotação; o viewer ao vivo salva
   screenshots com uma tecla.
3. **Muitos dados** — cada render produz `report.json`: dimensões reais em metros,
   árvore hierárquica com posição/tamanho/orientação mundial de cada peça, contagem
   de triângulos, materiais, **grafo de contatos** (distância real superfície-a-
   superfície entre cada par de peças, via BVH), **interfaces de montagem** (por
   onde cada conjunto se prende ao resto) e **visibilidade por peça** (pixels
   visíveis em 8 vistas).
4. **Detecção automática de erros estruturais** — conjuntos flutuando, peças
   presas só por contato rasante, conjuntos sustentados por peças emissivas/vidro,
   peças engolidas/invisíveis, modelo fora do chão, escala errada, meshes sem nome,
   geometria degenerada... Peças sinalizadas ganham **close-ups automáticos** na
   folha de contato.
5. **Qualidade por padrão** — estúdio de iluminação PBR (key/fill/rim + environment),
   tone mapping ACES, sombras suaves, e uma biblioteca de ~20 materiais físicos
   prontos (metal escovado, latão, vidro, cerâmica, borracha...).

## Instalação

```bash
npm install        # three + puppeteer-core (usa o Chrome/Edge já instalado)
```

Requisitos: Node 18+, Google Chrome ou Microsoft Edge instalado
(ou defina `AGENTFORGE_BROWSER` com o caminho de um Chromium).

## Uso

```bash
node bin/agentforge.mjs new robo            # cria models/robo.js a partir do template
# ... edite models/robo.js ...
node bin/agentforge.mjs render robo         # renderiza → renders/robo/sheet.png + report.json
node bin/agentforge.mjs dev                 # viewer ao vivo: http://127.0.0.1:4747 (hot reload)
node bin/agentforge.mjs export robo         # exporta exports/robo.glb (padrão da indústria)
```

Flags úteis do `render`:

| Flag | Efeito |
|---|---|
| `--focus Cabeca` | close-up enquadrado na peça nomeada "Cabeca" |
| `--isolate` | com `--focus`: esconde o resto do modelo |
| `--views persp,front,top` | só as vistas pedidas (mais rápido) |
| `--turntable` | +8 vistas girando ao redor do modelo |
| `--size 1600x1200` | resolução maior |
| `--json` | imprime o relatório completo no stdout |

Vistas disponíveis: `persp persp2 front back right left top bottom wire`.

## Escrevendo um modelo

Modelos são módulos ES em `models/*.js`. Unidades em **metros**, Y para cima,
modelo apoiado no chão (y=0):

```js
import * as THREE from 'three';

export const meta = { name: 'caneca', description: 'Caneca de café', units: 'meters' };

export function build({ THREE, mats, helpers: H }) {
  const root = H.group('Caneca');

  root.add(
    H.mesh('Corpo', H.lathe([
      [0.000, 0.000], [0.040, 0.000], [0.042, 0.004],
      [0.042, 0.095], [0.040, 0.098], [0.037, 0.095], [0.037, 0.008], [0.000, 0.008],
    ]), mats.ceramic(0xf3efe8)),
    H.mesh('Alca', H.tube([
      [0.042, 0.075, 0], [0.068, 0.065, 0], [0.070, 0.040, 0], [0.045, 0.028, 0],
    ], 0.006), mats.ceramic(0xf3efe8)),
  );

  return H.centerGround(root);   // centraliza e apoia no chão
}
```

O contexto entrega:
- **`mats`** — presets PBR: `plastic, glossyPlastic, matte, rubber, metal, chrome,
  brushedMetal, gold, brass, copper, paintedMetal, glass, frostedGlass, ceramic,
  wood, darkWood, fabric, skin, emissive, custom`
- **`helpers`** — `group, mesh, place, roundedBox, lathe, tube, cylinder, capsule,
  radialClone, mirrorX, measure, centerGround`, e para montagem segura entre
  frames rotacionados: `snap(filho, pontoLocal, alvo, pontoLocalAlvo)` (solda por
  pontos de ancoragem coincidentes), `worldPos(obj)`, `dist(a, b)`
- Qualquer import de `three` e `three/addons/*` também funciona direto no modelo.

O guia completo do fluxo para agentes está em [`CLAUDE.md`](CLAUDE.md).

## Estrutura

```
bin/agentforge.mjs     CLI
src/                   servidor, captura headless (puppeteer-core), template
web/                   viewer ao vivo + página de captura + libs compartilhadas
web/common/            stage (luz/câmeras), materials, helpers, analyze, loader
models/                seus modelos (example-lamp.js incluso)
renders/               saída: sheet.png, views/*.png, report.json
exports/               saída GLB
```
