# Assets pendentes

Nenhum asset externo foi usado na Fase 1, porque o ambiente de desenvolvimento não tinha acesso aos repositórios CC0. Tudo abaixo é **provisório** e foi gerado por código (geometria procedural de várias peças e texturas desenhadas em canvas). Cada item está registrado em `assets/manifest.json` com `"provisional": true`.

**Como substituir um asset:** exporte o GLB do Blender para a pasta indicada e troque a entrada no manifesto para `{ "type": "gltf", "src": "pasta/arquivo.glb" }`. Mantenha os **nós nomeados** do contrato, porque as mecânicas e as animações procedurais os procuram pelo nome.

> Observação: o caminho de carregamento GLB do `AssetManager` (`modelAsync`) está implementado, mas **não foi testado com um arquivo real** nesta fase. O primeiro GLB entregue deve vir com um teste de carregamento.

## Armas

| Id | Estado atual | Asset final necessário |
|---|---|---|
| `weapon.pistol-corvo.view` | Procedural, ~30 peças, 6 slots de material | GLB, 6–10 mil triângulos (1ª pessoa), escala em metros, cano em −Z, origem no topo da empunhadura. Nós: `slide`, `magazine`, `trigger`, `muzzle`. Materiais com os nomes dos slots `slide`, `frame`, `grip`, `barrel`, `details`, `sight`. Texturas PBR 2K (albedo, normal, ORM), KTX2. |
| `weapon.pistol-corvo.world` | A mesma geometria mesclada por material | LOD de 1,5–2 mil triângulos com os mesmos slots. |

## Personagens e braços

| Id | Estado atual | Asset final necessário |
|---|---|---|
| `character.operator` | Procedural, segmentos articulados **sem esqueleto**, animação por código (andar, agachar, no ar, queda simples) | GLB com rig humanoide (~55 ossos), 15–20 mil triângulos, 2 variações de uniforme (Vanguard azul / Phantom vermelho). Animações: idle, andar/correr em 8 direções (blend), agachado parado/andando, pulo (início, no ar, aterrissagem), troca de arma, disparo, recarga, impacto e morte. Hitboxes compatíveis: cabeça 1,5–1,8 m, tronco 0,85–1,5 m, pernas 0–0,85 m. |
| `fp.arms` | Procedural (mangas + luvas) | GLB de braços de 1ª pessoa com rig (clavícula → dedos), 8–12 mil triângulos, luvas trocáveis por material. Animações por arma (equipar, guardar, idle, disparo, recarga vazia/parcial, inspeção). |

## Texturas do mapa (Pátio 7)

| Id | Estado atual | Final |
|---|---|---|
| `tex.floor` | Ruído fractal + juntas (canvas 512) | PBR 2K tileável de placas de concreto (albedo/normal/ORM, KTX2) |
| `tex.concrete`, `tex.concreteDark` | Canvas 512 com marcas de fôrma | PBR 2K de concreto moldado |
| `tex.metal` | Canvas 512 com chapas e rebites | PBR 2K de aço (metallic real) |
| `tex.crate` | Canvas 512 de compósito com moldura | Modelo de caixa GLB com bevel e PBR |
| `tex.trim` | Canvas 512 com listras de sinalização | PBR de aço pintado com decalques |

Malha visual do mapa: hoje é gerada das caixas de colisão. O mapa final deve ser um GLB visual com props (ex.: CC0 da Kenney e da Quaternius, conferindo a licença), mantendo a colisão separada.

## Sons

Todos são **sintetizados por código** em `client/src/audio/AudioSystem.ts`: disparo, disparo distante, recarga, equipar, acerto, headshot, abate, disparo a seco, clique e dano. Os ids do manifesto `sfx.*` correspondem a esses sintetizadores.
Final: gravações originais ou CC0 (ex.: freesound.org filtrado por CC0), OGG/Opus 48 kHz, com variações (3–5 por som) e passos por superfície.
