# VÉRTICE

FPS 3D multiplayer competitivo no navegador: TypeScript, Three.js, Node.js e Socket.IO, com servidor autoritativo.

**Estado:** Fase 1 (multiplayer funcional). Veja `docs/FASES.md`.

## Requisitos

- Node.js 20+ (desenvolvido e testado com Node 22.23, npm 10.9)
- Navegador com WebGL2 (Chrome, Edge, Firefox ou Safari recentes)
- Para os testes com navegador: Google Chrome/Chromium instalado (`CHROME_PATH`, padrão `/usr/bin/google-chrome`)

## Instalação

```bash
npm install
```

## Rodar

### Produção / jogar com amigos (uma porta só)

```bash
npm run build      # gera client/dist
npm start          # servidor em http://localhost:3000 (serve o cliente + WebSocket)
```

Abra `http://localhost:3000`, escolha um nickname, clique em **Criar sala** e depois em **Copiar link de convite**.

### Desenvolvimento (recarregamento automático)

```bash
npm run dev        # servidor :3000 (tsx watch) + Vite :5173 (proxy de /socket.io)
```

Abra `http://localhost:5173`. Para testar com dois jogadores na mesma máquina, use **duas abas**: cada aba é um jogador (a sessão fica no `sessionStorage`).

### Variáveis de ambiente do servidor

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | 3000 | Porta HTTP/WebSocket |
| `HOST` | 0.0.0.0 | Interface |
| `NET_SIM_LATENCY_MS` | 0 | Latência simulada **total** (ida + volta), ex.: `150` |
| `NET_SIM_JITTER_MS` | 0 | Jitter simulado por direção |
| `LAG_COMPENSATION` | 1 | `0` desliga o rewind (só para comparação) |
| `RECONNECT_WINDOW_MS` | 30000 | Janela de reconexão |
| `LOG_LEVEL` | info | `silent`, `info`, `debug` |

Exemplo, testando sob latência: `NET_SIM_LATENCY_MS=150 NET_SIM_JITTER_MS=10 npm start`

## Jogar pela internet

O servidor serve o cliente e o WebSocket na mesma porta, então basta expor essa porta.

**Opção A: Cloudflare Tunnel (grátis, sem abrir portas no roteador)**

1. Instale o `cloudflared` ([página oficial de downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
2. Em um terminal: `npm run build && npm start`
3. Em outro: `cloudflared tunnel --url http://localhost:3000`
4. Ele mostra um endereço `https://<algo>.trycloudflare.com`. Abra esse endereço, crie a sala e mande o link de convite aos amigos.

O túnel rápido funciona com WebSocket. A latência dos amigos passa a incluir o caminho até a Cloudflare.

**Opção B: deploy em um serviço Node** (Render, Railway, Fly.io etc.)

- Build: `npm ci && npm run build`
- Start: `npm start`
- O serviço precisa aceitar WebSocket (todos os citados aceitam) e expor a porta definida em `PORT`.

> ⚠️ Limitação desta entrega: os túneis e o deploy **não foram testados** entre computadores diferentes, porque o ambiente de desenvolvimento não tinha acesso de entrada pela internet. O fluxo completo foi testado com dois navegadores reais na mesma máquina.

## Controles

| Ação | Tecla |
|---|---|
| Mover | W A S D |
| Mirar / Câmera | Mouse (Pointer Lock — clique na tela) |
| Atirar | Botão esquerdo |
| Correr | Shift |
| Agachar | Ctrl ou C (prefira C: Ctrl+W fecha a aba) |
| Pular | Espaço |
| Recarregar | R |
| Placar | Tab (segurar) |
| Painel de depuração | F3 |
| Menu / pausa | Esc |

Todas as teclas acima são remapeáveis em **Configurações → Controles**.

## Testes

```bash
npm test                     # unitários + integração (2 clientes headless), ~35 s
npm run typecheck            # TypeScript strict nos 3 pacotes
npm run build && npm run test:e2e                       # 2 navegadores Chrome reais
npm run build && npm run test:e2e -- --minutes=5 --lag=150   # estabilidade de 5 min sob 150 ms
node --import tsx tests/e2e/screenshots.ts              # capturas de tela de referência
```

As capturas e o `resultado.json` do e2e ficam em `tests/e2e/output/`.

## Estrutura

```
shared/src   constants · math · physics (AABB, movimento, hitboxes) · combat · sim · net (predição, interpolação) · protocols (Zod) · data (armas, mapas, botNames.json)
server/src   network (GameServer, netsim) · rooms · matches · combat (rewind) · players · security · core
client/src   app · core (Game, Renderer, Input) · multiplayer · assets (AssetManager, texturas) · maps · weapons · characters · effects · audio · ui (telas, HUD) · config
assets/      manifest.json (registro de todos os assets)
docs/        ARQUITETURA · PROTOCOLO · ASSETS_PENDENTES · CREDITOS · FASES
tests/       integration (Vitest + clientes headless) · e2e (Playwright + Chrome)
```

Mais detalhes em `docs/ARQUITETURA.md` e `docs/PROTOCOLO.md`.
