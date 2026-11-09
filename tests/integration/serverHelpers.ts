import { createServer } from '../../server/src/createServer.js';
import type { RunningServer } from '../../server/src/createServer.js';
import { loadConfig } from '../../server/src/config.js';
import type { ServerConfig } from '../../server/src/config.js';
import type { MatchPlayer } from '../../server/src/matches/Match.js';
import { HeadlessClient, waitFor } from './HeadlessClient.js';

export const startTestServer = (over: Partial<ServerConfig> = {}): Promise<RunningServer> =>
  createServer({ ...loadConfig({}), port: 0, host: '127.0.0.1', clientDist: null, logLevel: 'silent', ...over });

/** Acesso ao estado autoritativo (somente para preparar/verificar testes). */
export const matchPlayer = (srv: RunningServer, id: string): MatchPlayer => {
  for (const room of srv.game.rooms.values()) {
    const p = room.match?.players.get(id);
    if (p) return p;
  }
  throw new Error(`jogador ${id} não está em partida`);
};

/** Teleporta um jogador no servidor (preparação de cenário de teste). */
export const teleport = (srv: RunningServer, id: string, x: number, y: number, z: number, yaw = 0): void => {
  const p = matchPlayer(srv, id);
  p.sim.move.pos = { x, y, z };
  p.sim.move.vel = { x: 0, y: 0, z: 0 };
  p.sim.move.onGround = true;
  p.spawnYaw = yaw;
  p.spawnProtectUntil = 0;
  p.life++;
  p.history.clear();
};

/** Cria sala com A como anfitrião, B entra pelo código, partida iniciada. */
export const setupDuel = async (srv: RunningServer): Promise<{ a: HeadlessClient; b: HeadlessClient; code: string }> => {
  const url = `http://127.0.0.1:${srv.port}`;
  const a = new HeadlessClient(url, 'Alfa');
  const b = new HeadlessClient(url, 'Bravo');
  await a.connect();
  await b.connect();
  const code = await a.createRoom();
  const j = await b.join(code);
  if (!j.ok) throw new Error(j.error);
  await waitFor(() => a.room?.players.length === 2 && b.room?.players.length === 2, 5000, 'lobby com 2');
  const st = await a.call('match:start', {});
  if (!st.ok) throw new Error(st.error);
  await waitFor(() => !!a.match && !!b.match, 5000, 'match:start');
  a.startInput();
  b.startInput();
  await waitFor(() => a.snapCount > 5 && b.snapCount > 5, 5000, 'snapshots');
  return { a, b, code };
};
