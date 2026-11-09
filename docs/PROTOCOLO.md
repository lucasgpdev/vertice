# Protocolo de rede (v1)

Transporte: Socket.IO 4 sobre **WebSocket** (sem polling). Os esquemas ficam em `shared/src/protocols/messages.ts`.
Todo evento recebido pelo servidor passa pelo **limite de taxa** e depois pela **validação Zod estrita**. Uma mensagem inválida é descartada e contada; um evento desconhecido é ignorado e contado.

## Cliente → Servidor

| Evento | Payload | Ack | Limite |
|---|---|---|---|
| `hello` | `{ v: 1, nickname, session? }` | `{ ok, playerId, session, nickname, resumedRoom }` | 1/s (rajada 3) |
| `room:create` | `{ settings: RoomSettings }` | `{ ok, code }` | 1/s |
| `room:join` | `{ code }` (6 chars, alfabeto sem 0/O/1/I/L) | `{ ok, code }` | 2/s |
| `room:leave` | `{}` | `{ ok }` | 2/s |
| `room:kick` | `{ playerId }` — só anfitrião | `{ ok }` | 2/s |
| `room:update` | `{ settings }` — só anfitrião, só no lobby | `{ ok }` | 4/s |
| `match:start` | `{}` — só anfitrião, ≥ 2 conectados | `{ ok }` | 1/s |
| `match:end` | `{}` — só anfitrião | `{ ok }` | 1/s |
| `input` | `InputCmd[]` (1–4) | — | 75/s (rajada 45) |
| `pong` | `{ n }` | — | 3/s |
| `clock` | `{ c }` | `{ ok, c, s }` | 4/s |

`RoomSettings = { maxPlayers 2–10, modeId 'deathmatch', mapId 'arena-patio7', killLimit 5–100, timeLimitMin 2–30 }`

### InputCmd

```ts
{ s: number,  // sequência crescente (int ≥ 0)
  b: number,  // bitmask: Forward 1, Back 2, Left 4, Right 8, Jump 16, Crouch 32, Sprint 64, Fire 128, Reload 256, Aim 512
  y: number,  // yaw (rad)
  p: number,  // pitch (rad, ±π/2)
  vt: number } // tempo do servidor (ms) que o cliente renderizava — usado no rewind
```
O cliente **não envia** posição, velocidade, dano, acerto nem munição.

## Servidor → Cliente

| Evento | Conteúdo |
|---|---|
| `room:state` | `{ code, hostId, phase: lobby/playing/results, settings, players[] }` (ao mudar e a cada 1 s no lobby, para atualizar o ping) |
| `room:kicked` | `{ reason }` |
| `match:start` | `{ mapId, modeId, selfId, tick, serverTime, killLimit, endsAt }` (também reenviado ao reconectar) |
| `snap` (30 Hz) | `{ t, st, self, ents[], ev[] }` |
| `score` | `ScoreRow[]` — ao mudar e a cada 1 s |
| `match:end` | `{ winnerId, reason, scoreboard, backToLobbyInMs }` |
| `ping` | `{ n }` — o servidor mede o RTT pela resposta `pong` |
| `server:error` | `{ error }` (ex.: sessão assumida por outra aba) |

### Snapshot

- `self`: estado **completo** do próprio jogador para reconciliação: `ack` (último input processado), posição, velocidade, chão, agachado, estado da arma (`ammo`, `reserve`, `cd`, `rl`, `eq`, `th`, `sc`, `bl`), semente, vida, vivo, `tp` (contador de spawn), `sy` (yaw do spawn), `respawnIn`.
- `ents`: os outros jogadores, quantizados: `p` em cm, `y`/`pi` em mrad, `ct`, `g`, `sp` (velocidade horizontal para animação), `hp`, `a`, `w`, `tp`.
- `ev`: eventos desde o último snapshot.
  - `shot` (para os outros): origem, fim, tipo de acerto e normal.
  - `hit` (só para o atirador): vítima, dano, região, se foi abate.
  - `hurt` (só para a vítima): origem do disparo e dano.
  - `kill`, `spawn` e `reload` (para todos).

## Netcode

1. **Predição:** a cada tick de 60 Hz o cliente cria um `InputCmd`, aplica localmente com `stepPlayerSim` (o mesmo código do servidor), guarda como pendente e envia.
2. **Servidor:** cada tick dá 1 ficha de input ao jogador (máx. 8 acumuladas) e processa da fila. Em seguida faz respawn, grava o histórico e, a cada 2 ticks, envia o snapshot.
3. **Reconciliação:** ao receber `self`, o cliente descarta os pendentes com `s ≤ ack`, adota o estado oficial e reaplica os pendentes. A diferença visual vira um offset que decai em ~70 ms; um teleporte (`tp` mudou) não é suavizado.
4. **Interpolação:** os remotos são desenhados em `relógioDeSnapshots − 100 ms`. O relógio é estimado pela chegada dos snapshots (EMA assimétrica).
5. **Compensação de latência:** no disparo, o servidor posiciona os outros jogadores no instante `vt`, limitado a `[agora − min(320, RTT+170), agora]` e interpolado do histórico, e faz o raycast contra o mapa e as hitboxes.

Resultado medido (teste automatizado, 150 ms de RTT, alvo correndo lateralmente a 18 m): **25/25 acertos com compensação** contra **3/25 sem compensação**.
