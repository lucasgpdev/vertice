# Arquitetura — VÉRTICE

## Visão geral

```
 Navegador (client)                               Servidor Node (server)
 ┌───────────────────────────────┐   WebSocket    ┌──────────────────────────────────┐
 │ Input (teclado/mouse, 60 Hz)  │  InputCmd[]    │ Rate limit por conexão/evento    │
 │   └▶ Predictor.step()         │───────────────▶│ Validação Zod estrita            │
 │        (shared/sim)           │                │ Fila de inputs + orçamento/tick  │
 │ Reconciliação (reaplica)      │◀───────────────│ Simulação 60 Hz (shared/sim)     │
 │ InterpolationBuffer (−100 ms) │  Snapshot 30Hz │ Disparo: rewind ≤ 320 ms         │
 │ Three.js: mapa, operadores,   │  + eventos     │ Dano/vida/abates/placar          │
 │ viewmodel, efeitos, HUD (DOM) │                │ Salas, anfitrião, reconexão 30 s │
 └───────────────────────────────┘                └──────────────────────────────────┘
          ▲            mesmo código: movimento, colisão, hitboxes, armas           ▲
          └───────────────────────── shared (TypeScript) ──────────────────────────┘
```

## Pacotes (npm workspaces)

| Pacote | Papel |
|---|---|
| `shared` | Constantes, protocolo (Zod), física AABB, movimento, hitboxes, simulação de arma, dados (armas, mapas, nomes de bots), predição/interpolação. Sem dependência de Three.js nem de Node. |
| `server` | Fastify (HTTP/estáticos/`/api/health`) + Socket.IO. `GameServer` (rede), `Room` (sala), `Match` (simulação autoritativa), `PositionHistory` (rewind), `ConnectionRateLimiter`, `DelayLine` (latência simulada). |
| `client` | Vite + Three.js. `App` (telas), `Connection`, `Game` (partida), `Renderer`, `AssetManager`, `MapBuilder`, `ViewModel`, `RemotePlayer`, `Effects`, `AudioSystem`, HUD e telas em DOM. |

Pastas da seção 4 do briefing que ainda não têm código (bots, chat, ranking, database, skins, inventário…) **não foram criadas vazias**; elas surgem na fase correspondente.

## Decisões técnicas

- **Física própria em `shared` em vez de Rapier.** O mapa da Fase 1 é feito de caixas. Um AABB vs caixas com resolução por eixo, degraus (0,45 m) e encaixe ao descer é determinístico, roda igual em Node e no navegador e custa microssegundos. Rapier (WASM) só se justifica com malhas de colisão arbitrárias; isso será reavaliado na Fase 6.
- **Grade uniforme (broadphase)** no `CollisionWorld`, para que mapas com centenas de caixas continuem baratos.
- **Estado da arma simulado por input** (cooldown, recarga e bloom contados em ticks de input, não em relógio). Assim a predição reaplicada no cliente reproduz o resultado do servidor.
- **Dispersão determinística:** `shotDirection(yaw, pitch, spread, seed, shotIndex)` usa um RNG com semente por spawn definida pelo servidor. O traçante previsto no cliente sai na mesma direção que o servidor valida.
- **Somente WebSocket** (sem long-polling): menor latência, sem rajadas HTTP.
- **JSON quantizado** (posições em cm, ângulos em mrad) nos snapshots. Um snapshot de 2 jogadores tem cerca de 0,6 KB. Delta/binário fica para a Fase 8, quando houver 10 jogadores e mais estado.
- **HUD em DOM** sobre o canvas: texto nítido, barato e fácil de estilizar; o render 3D não é afetado.
- **Viewmodel em cena separada**, renderizada depois do mundo com `clearDepth()`: a arma nunca atravessa paredes e tem FOV próprio.
- **Mesclagem por material:** a geometria estática do mapa sai em cerca de 7 draw calls; cada operador remoto em cerca de 11; os mapas têm uma meta (`perfBudget.maxDrawCalls`).

## Fluxo de uma partida

1. O anfitrião cria a sala (`room:create`) e recebe um código de 6 caracteres de um alfabeto sem caracteres ambíguos. O link de convite é `/?sala=CÓDIGO`.
2. Os convidados entram (`room:join`). O servidor valida: a sala existe, há vaga e o jogador não foi expulso.
3. O anfitrião inicia (`match:start`, mínimo de 2 conectados). O `Match` é criado e cada jogador recebe `match:start` e nasce no spawn mais distante dos inimigos.
4. Laço de 60 Hz: consome inputs, resolve disparos, faz respawn depois de 3 s e grava o histórico. A cada 2 ticks envia o snapshot e, quando muda, o placar.
5. A partida termina no limite de abates, no limite de tempo ou por ação do anfitrião. O resultado vai para todos e, depois de 10 s, a sala volta ao lobby.

## Reconexão

- O token de sessão (32 hex) fica no `sessionStorage`, ou seja, **por aba**: duas abas são dois jogadores.
- Quando a conexão cai, a sessão fica "desconectada", sai da simulação (fica invisível e não pode ser atingida) e **mantém as estatísticas**.
- O Socket.IO reconecta sozinho e o cliente reenvia `hello` com o token. Dentro de 30 s, o jogador volta à mesma sala e partida e nasce de novo.
- Depois da janela, a sessão expira e o jogador sai da sala. Se ele era o anfitrião, o cargo passa para o próximo conectado.
- O heartbeat (ping 2 s / timeout 3 s) detecta a queda em ~5 s.

## Segurança (Fase 1)

| Ameaça | Defesa |
|---|---|
| Posição falsa / teleporte | O protocolo não tem campo de posição; o esquema Zod estrito rejeita campos extras. |
| Speedhack (mais inputs por segundo) | Orçamento de 1 input por tick (rajada máx. 8), fila máx. 32, limite de taxa por evento. |
| Cadência acima do permitido | Cooldown e semiautomático (soltar o gatilho) decididos no servidor. |
| Dano/abate inventado | Não existem mensagens para isso; eventos desconhecidos são descartados e contados. |
| Rewind abusivo (`vt` antigo) | `vt` limitado a `min(320 ms, RTT + 100 + 70)` atrás do tempo atual. |
| Ações de anfitrião | Iniciar, encerrar, expulsar e alterar a sala são verificados no servidor. |
| Flood | Balde de fichas por conexão e por evento; abuso persistente derruba a conexão; `maxHttpBufferSize` de 16 KB. |

## Pontos de extensão já previstos

- **Armas:** basta adicionar uma entrada em `shared/src/data/weapons.ts`. Servidor e cliente usam os mesmos dados, e o perfil de animação fica em `ViewModel.PROFILE`.
- **Skins:** a pistola expõe slots de material (`slide`, `frame`, `grip`, `barrel`, `details`, `sight`), no viewmodel e no modelo de terceira pessoa.
- **Mapas:** um `MapDef` novo em `shared/src/data/maps/`. Colisão e visual são gerados das caixas; malhas GLB podem substituir o visual sem mudar a colisão.
- **Bots (Fase 5):** vão gerar `InputCmd` pela mesma fila do `Match`, sem atalhos. `botNames.json` já existe.
- **Modos:** `RoomSettings.modeId` é um literal hoje; os modos novos entram como estratégias do `Match`.
