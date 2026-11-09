import { afterEach, describe, expect, it } from 'vitest';
import { Buttons, MOVE } from '@vertice/shared';
import type { RunningServer } from '../../server/src/createServer.js';
import { HeadlessClient, sleep, waitFor } from './HeadlessClient.js';
import { matchPlayer, setupDuel, startTestServer, teleport } from './serverHelpers.js';

let srv: RunningServer | null = null;
const clients: HeadlessClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  await srv?.close();
  srv = null;
});
const track = (...c: HeadlessClient[]) => clients.push(...c);

describe('salas e lobby', () => {
  it('cria sala com código de 6 caracteres e outro jogador entra pelo código', async () => {
    srv = await startTestServer();
    const { a, b, code } = await setupDuel(srv);
    track(a, b);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(a.room?.hostId).toBe(a.id);
    expect(b.room?.players.map((p) => p.nickname).sort()).toEqual(['Alfa', 'Bravo']);
  });

  it('código inexistente é recusado; somente o anfitrião inicia/expulsa', async () => {
    srv = await startTestServer();
    const url = `http://127.0.0.1:${srv.port}`;
    const a = new HeadlessClient(url, 'Host1');
    const b = new HeadlessClient(url, 'Guest1');
    track(a, b);
    await a.connect();
    await b.connect();
    expect((await b.join('ZZZZZZ')).ok).toBe(false);
    const code = await a.createRoom();
    expect((await b.join(code)).ok).toBe(true);
    expect((await b.call('match:start', {})).ok).toBe(false);
    expect((await b.call('room:kick', { playerId: a.id })).ok).toBe(false);
    expect((await a.call('room:kick', { playerId: b.id })).ok).toBe(true);
    await waitFor(() => b.kicked, 3000, 'kick');
    expect((await b.join(code)).ok).toBe(false); // expulso não volta
  });
});

describe('movimento sincronizado', () => {
  it('o movimento de B aparece para A e a predição de B bate com o servidor', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, b.id, -10, 0, 6);
    await sleep(300);
    const start = a.view(b.id)!;
    b.yaw = -Math.PI / 2; // frente = +X
    b.buttons = Buttons.Forward;
    await sleep(1000);
    b.buttons = 0;
    await sleep(600);
    const end = a.view(b.id)!;
    const server = matchPlayer(srv, b.id).sim.move.pos;
    expect(end.x - start.x).toBeGreaterThan(3.5);
    expect(Math.abs(end.x - server.x)).toBeLessThan(0.05);
    expect(b.predictor.lastError).toBeLessThan(0.02);
    const pb = b.predictor.state.move.pos;
    expect(Math.hypot(pb.x - server.x, pb.z - server.z)).toBeLessThan(0.02);
  });
});

/** Mede a taxa de acerto de A atirando em B, que corre de um lado para o outro. */
const strafeDuel = async (srv: RunningServer, shots: number) => {
  const { a, b } = await setupDuel(srv);
  track(a, b);
  teleport(srv, a.id, -10, 0, 6, -Math.PI / 2);
  teleport(srv, b.id, 8, 0, 6, Math.PI / 2);
  await sleep(600);
  let dir = 1;
  let ticks = 0;
  b.onTick = (c) => {
    // B corre lateralmente (eixo Z) trocando de direção a cada 0,7 s.
    if (++ticks % 42 === 0) dir = -dir;
    c.yaw = Math.PI / 2; // frente = -X; direita = -Z
    c.buttons = dir > 0 ? Buttons.Right : Buttons.Left;
  };
  // Mantém B "imortal" para medir apenas acertos.
  const hb = matchPlayer(srv, b.id);
  const ha = matchPlayer(srv, a.id);
  let fired = 0;
  let tick = 0;
  a.onTick = (c) => {
    hb.hp = 100;
    ha.sim.weapon.ammo = 12; // carregador "infinito" no servidor: mede só a mira
    c.aimAt(b.id);
    tick++;
    if (tick % 12 === 0 && fired < shots) {
      c.pressFire(true);
      fired++;
    } else c.pressFire(false);
  };
  await sleep(1000 + (shots * 12 * 1000) / 60 + 500);
  const hits = a.events.filter((e) => e.k === 'hit').length;
  const shotsServer = ha.stats.shotsFired;
  console.log(`[strafeDuel] lagComp=${srv.game['cfg'].lagCompensation} acertos ${hits}/${shotsServer}`);
  return { hits, shots: shotsServer };
};

describe('combate com latência', () => {
  it('com 150 ms de latência e compensação: acertos justos em alvo em movimento', async () => {
    srv = await startTestServer({ simLatencyMs: 150, simJitterMs: 10 });
    const r = await strafeDuel(srv, 25);
    expect(r.shots).toBeGreaterThanOrEqual(20);
    expect(r.hits / r.shots).toBeGreaterThan(0.85);
  }, 30_000);

  it('com 150 ms de latência, o movimento remoto interpolado é contínuo (sem buffer vazio nem saltos)', async () => {
    srv = await startTestServer({ simLatencyMs: 150, simJitterMs: 10 });
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, b.id, 8, 0, 6, Math.PI / 2);
    await sleep(800);
    let dir = 1;
    let ticks = 0;
    b.onTick = (c) => {
      if (++ticks % 42 === 0) dir = -dir;
      c.yaw = Math.PI / 2;
      c.buttons = dir > 0 ? Buttons.Right : Buttons.Left;
    };
    await sleep(500);
    let samples = 0;
    let starved = 0;
    let maxStep = 0;
    let prev: { x: number; z: number } | null = null;
    let prevT = performance.now();
    const end = performance.now() + 5000;
    while (performance.now() < end) {
      await sleep(16);
      const t = performance.now();
      if (a.clock.renderTime(t) > a.interp.latestTime) starved++;
      const v = a.view(b.id);
      if (v && prev) maxStep = Math.max(maxStep, Math.hypot(v.x - prev.x, v.z - prev.z) / ((t - prevT) / 1000));
      if (v) prev = { x: v.x, z: v.z };
      prevT = t;
      samples++;
    }
    console.log(`[suavidade] amostras ${samples} · buffer vazio ${starved} · velocidade aparente máx. ${maxStep.toFixed(2)} m/s`);
    expect(starved / samples).toBeLessThan(0.02);
    // Velocidade aparente nunca muito acima da real (4,6 m/s) → sem "teleportes".
    expect(maxStep).toBeLessThan(MOVE.walkSpeed * 1.6);
  }, 30_000);

  it('controle: SEM compensação, os mesmos disparos erram bem mais', async () => {
    srv = await startTestServer({ simLatencyMs: 150, simJitterMs: 10, lagCompensation: false });
    const r = await strafeDuel(srv, 25);
    expect(r.hits / r.shots).toBeLessThan(0.5);
  }, 30_000);

  it('dano, eliminação, placar e respawn decididos pelo servidor', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, a.id, -10, 0, 6, -Math.PI / 2);
    teleport(srv, b.id, 8, 0, 6, Math.PI / 2);
    await sleep(400);
    let t = 0;
    a.onTick = (c) => {
      c.aimAt(b.id, 1.15);
      c.pressFire(++t % 12 === 0);
    };
    await waitFor(() => a.events.some((e) => e.k === 'kill'), 10_000, 'eliminação');
    a.onTick = null;
    a.pressFire(false);
    const kill = a.events.find((e) => e.k === 'kill')!;
    expect(kill).toMatchObject({ killer: a.id, victim: b.id });
    // Pistola: 30 de dano no tronco → 4 acertos para eliminar.
    expect(a.events.filter((e) => e.k === 'hit').length).toBe(4);
    expect(b.events.filter((e) => e.k === 'hurt').length).toBe(4);
    await waitFor(() => a.score.find((r) => r.id === a.id)?.kills === 1, 3000, 'placar');
    expect(b.predictor.alive).toBe(false);
    await waitFor(() => b.predictor.alive && b.predictor.hp === 100, 5000, 'respawn');
    expect(a.score.find((r) => r.id === b.id)?.deaths).toBe(1);
  }, 20_000);
});

describe('anti-trapaça (cliente modificado)', () => {
  it('posição falsa e eventos inventados são descartados', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, b.id, 0, 0, 15);
    await sleep(200);
    const before = { ...matchPlayer(srv, b.id).sim.move.pos };
    const invalidBefore = srv.game.counters.invalidMessages;
    const unknownBefore = srv.game.counters.unknownEvents;
    b.stopInput();
    // Input com campo extra de posição → esquema estrito rejeita.
    b.socket.emit('input', [{ s: 999_999, b: 0, y: 0, p: 0, vt: 0, pos: { x: 50, y: 0, z: 50 } }]);
    // Eventos fora do protocolo.
    b.socket.emit('setPosition', { x: 50, y: 0, z: 50 });
    a.socket.emit('damage', { victim: b.id, amount: 999 });
    a.socket.emit('hit', { victim: b.id, region: 'head', dmg: 999 });
    a.socket.emit('kill', { victim: b.id });
    // Tipos errados / valores fora da faixa.
    b.socket.emit('input', [{ s: -1, b: 1 << 20, y: Infinity, p: 9, vt: 0 }]);
    b.socket.emit('input', 'lixo');
    await sleep(400);
    const after = matchPlayer(srv, b.id).sim.move.pos;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
    expect(matchPlayer(srv, b.id).hp).toBe(100);
    expect(matchPlayer(srv, a.id).kills).toBe(0);
    expect(srv.game.counters.invalidMessages - invalidBefore).toBeGreaterThanOrEqual(3);
    expect(srv.game.counters.unknownEvents - unknownBefore).toBeGreaterThanOrEqual(4);
  });

  it('speedhack: enviar inputs 3x mais rápido não aumenta a velocidade', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, b.id, -12, 0, 6);
    await sleep(300);
    b.stopInput();
    const p = matchPlayer(srv, b.id);
    const x0 = p.sim.move.pos.x;
    const t0 = performance.now();
    // 180 inputs/s andando para +X durante 2 s.
    let seq = 10_000;
    const iv = setInterval(() => {
      for (let i = 0; i < 3; i++) b.sendInputs([{ s: seq++, b: Buttons.Forward, y: -Math.PI / 2, p: 0, vt: 0 }]);
    }, 1000 / 60);
    await sleep(2000);
    clearInterval(iv);
    await sleep(300);
    const elapsed = (performance.now() - t0) / 1000;
    const moved = p.sim.move.pos.x - x0;
    expect(moved).toBeGreaterThan(1);
    expect(moved).toBeLessThanOrEqual(MOVE.walkSpeed * elapsed * 1.05);
    expect(p.stats.inputsProcessed).toBeLessThan(b.sentInputs * 0.6);
  });

  it('cadência: disparar acima do limite é ignorado pelo servidor', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    teleport(srv, a.id, 0, 0, 15);
    await sleep(400);
    a.stopInput();
    const p = matchPlayer(srv, a.id);
    p.sim.weapon.reserve = 999; // munição de sobra para isolar a cadência
    const shots0 = p.stats.shotsFired;
    let seq = 50_000;
    const t0 = performance.now();
    // Lotes de 4 inputs alternando gatilho (pressiona/solta) a 60 lotes/s.
    const iv = setInterval(() => {
      const batch = [0, 1, 2, 3].map((i) => ({ s: seq++, b: i % 2 === 0 ? Buttons.Fire : 0, y: 0, p: 0, vt: 0 }));
      a.sendInputs(batch);
    }, 1000 / 60);
    await sleep(2000);
    clearInterval(iv);
    await sleep(300);
    const elapsed = (performance.now() - t0) / 1000;
    const shots = p.stats.shotsFired - shots0;
    const maxLegit = Math.ceil(elapsed / 0.15) + 1;
    expect(shots).toBeGreaterThan(0);
    expect(shots).toBeLessThanOrEqual(maxLegit);
  });
});

describe('desconexão e reconexão', () => {
  it('reconectar dentro da janela devolve o jogador à partida com as estatísticas', async () => {
    srv = await startTestServer();
    const { a, b, code } = await setupDuel(srv);
    track(a, b);
    matchPlayer(srv, b.id).kills = 3;
    const token = b.session;
    const id = b.id;
    b.disconnect();
    await waitFor(() => a.score.find((r) => r.id === id)?.status === 'disconnected', 3000, 'status desconectado');
    // Durante a queda, B não aparece como entidade para A.
    await sleep(200);
    expect(a.lastSnap?.ents.some((e) => e.id === id)).toBe(false);

    const b2 = new HeadlessClient(b.url, 'Bravo');
    track(b2);
    const hello = await b2.connect(token);
    expect(hello.playerId).toBe(id);
    expect(hello.resumedRoom).toBe(code);
    await waitFor(() => !!b2.match, 3000, 'match:start após reconectar');
    b2.startInput();
    await waitFor(() => b2.predictor.alive, 3000, 'vivo após reconectar');
    await waitFor(() => a.score.find((r) => r.id === id)?.status === 'connected', 3000, 'status conectado');
    expect(a.score.find((r) => r.id === id)?.kills).toBe(3);
    await waitFor(() => !!a.lastSnap?.ents.some((e) => e.id === id), 3000, 'entidade visível de novo');
  });

  it('após a janela de reconexão, a sessão expira e o jogador sai da sala', async () => {
    srv = await startTestServer({ reconnectWindowMs: 1500 });
    const { a, b } = await setupDuel(srv);
    track(a, b);
    const token = b.session;
    const id = b.id;
    b.disconnect();
    await waitFor(() => !a.room?.players.some((p) => p.id === id), 5000, 'saída da sala');
    const b2 = new HeadlessClient(b.url, 'Bravo');
    track(b2);
    const hello = await b2.connect(token);
    expect(hello.playerId).not.toBe(id);
    expect(hello.resumedRoom).toBeNull();
  });

  it('se o anfitrião sair, outro jogador vira anfitrião', async () => {
    srv = await startTestServer();
    const { a, b } = await setupDuel(srv);
    track(a, b);
    await a.call('room:leave', {});
    await waitFor(() => b.room?.hostId === b.id, 3000, 'novo anfitrião');
  });
});
