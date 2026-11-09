import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { PROTOCOL_VERSION } from '@vertice/shared';
import type { ServerConfig } from './config.js';
import { GameServer } from './network/GameServer.js';
import { log, setLogLevel } from './core/logger.js';

export interface RunningServer {
  port: number;
  game: GameServer;
  close: () => Promise<void>;
}

/** Cria HTTP (Fastify) + WebSocket (Socket.IO) + laço do jogo. */
export const createServer = async (cfg: ServerConfig): Promise<RunningServer> => {
  setLogLevel(cfg.logLevel);
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });

  app.get('/api/health', async () => ({ ok: true, protocol: PROTOCOL_VERSION }));

  const dist = cfg.clientDist;
  const hasClient = !!dist && fs.existsSync(path.join(dist, 'index.html'));
  if (hasClient) {
    await app.register(fastifyStatic, { root: dist!, prefix: '/', wildcard: false });
    // SPA: qualquer rota GET desconhecida devolve o index (links de convite).
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'não encontrado' });
    });
  }

  await app.listen({ port: cfg.port, host: cfg.host });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : cfg.port;

  const io = new Server(app.server, {
    cors: { origin: cfg.corsOrigins },
    maxHttpBufferSize: 16 * 1024,
    // Heartbeat curto: detecta queda de conexão em ~5 s (janela de reconexão = 30 s).
    pingInterval: 2_000,
    pingTimeout: 3_000,
    // WebSocket direto: sem long-polling (menor latência e sem rajadas de HTTP).
    transports: ['websocket'],
  });
  const game = new GameServer(io, cfg);
  game.start();

  log.info(`servidor ouvindo em http://${cfg.host}:${port}` + (hasClient ? ' (servindo cliente)' : ' (sem build do cliente)'));
  if (cfg.simLatencyMs > 0) log.info(`latência simulada: ${cfg.simLatencyMs} ms RTT (±${cfg.simJitterMs} ms)`);
  if (!cfg.lagCompensation) log.warn('compensação de latência DESLIGADA');

  return {
    port,
    game,
    close: async () => {
      game.stop();
      await new Promise<void>((r) => io.close(() => r()));
      await app.close().catch(() => undefined);
    },
  };
};
