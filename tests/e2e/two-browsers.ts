/**
 * Teste ponta a ponta com DOIS navegadores Chrome reais (headless, WebGL via
 * SwiftShader). Sobe o servidor no mesmo processo (servindo o build do
 * cliente), cria sala no navegador A, entra pelo LINK de convite no B,
 * inicia a partida, movimenta, combate, derruba a rede do B e verifica a
 * reconexão. Com --minutes=N mantém a partida por N minutos (teste de
 * estabilidade) e conta erros de console do cliente e do servidor.
 *
 * Uso: npm run build && npm run test:e2e [-- --minutes=5 --lag=150]
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type ConsoleMessage, type Page } from 'playwright-core';
import { createServer } from '../../server/src/createServer.js';
import { loadConfig } from '../../server/src/config.js';
import { matchPlayer, teleport } from '../integration/serverHelpers.js';

const arg = (name: string, d: number): number => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : d;
};
const MINUTES = arg('minutes', 0);
const LAG = arg('lag', 0);
const OUT = path.resolve('tests/e2e/output');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';

const VIEWPORT = { width: Number(process.env.E2E_W ?? 640), height: Number(process.env.E2E_H ?? 360) };
let offlineWindow = false;
const ignored: string[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { name: string; ok: boolean; info?: string }[] = [];
const check = (name: string, ok: boolean, info?: string) => {
  results.push({ name, ok, info });
  console.log(`${ok ? '✔' : '✘'} ${name}${info ? ` — ${info}` : ''}`);
};

// Captura erros do servidor (console.error / console.warn).
const serverErrors: string[] = [];
const origErr = console.error;
const origWarn = console.warn;
console.error = (...a: unknown[]) => {
  serverErrors.push(a.map(String).join(' '));
  origErr(...a);
};
console.warn = (...a: unknown[]) => {
  serverErrors.push(a.map(String).join(' '));
  origWarn(...a);
};

type VState = {
  alive: boolean;
  hp: number;
  pos: { x: number; y: number; z: number };
  ammo: number;
  remotes: { id: string; x: number; y: number; z: number; alive: boolean; labelVisible: boolean }[];
  score: { id: string; kills: number; deaths: number; status: string }[];
  fps: number;
  snapRate: number;
  predictionError: number;
  drawCalls: number;
  starvedFrames: number;
  framesTotal: number;
};
const vstate = (p: Page) => p.evaluate(() => (window as unknown as { __vertice?: { state: () => unknown } }).__vertice?.state() ?? null) as Promise<VState | null>;

const main = async (): Promise<void> => {
  const srv = await createServer({
    ...loadConfig({}),
    port: 0,
    host: '127.0.0.1',
    logLevel: 'info',
    simLatencyMs: LAG,
    simJitterMs: LAG > 0 ? 10 : 0,
  });
  const base = `http://127.0.0.1:${srv.port}`;
  console.log(`servidor de teste em ${base} (latência simulada ${LAG} ms)`);

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
  });
  const consoleErrors: Record<string, string[]> = { A: [], B: [] };
  const mkPage = async (label: 'A' | 'B') => {
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    // Renderização por CPU (SwiftShader) é lenta: qualidade Baixa no teste.
    const q = process.env.E2E_QUALITY ?? 'low';
    await ctx.addInitScript((quality) => {
      const presets: Record<string, unknown> = {
        low: { shadows: 'off', renderScale: 0.5, antialias: false },
        medium: { shadows: 'low', renderScale: 1, antialias: false },
        high: { shadows: 'high', renderScale: 1, antialias: true },
      };
      localStorage.setItem('vertice.settings.v1', JSON.stringify({ quality, graphics: presets[quality] }));
    }, q);
    const page = await ctx.newPage();
    page.on('console', (m: ConsoleMessage) => {
      if (m.type() !== 'error' && m.type() !== 'warning') return;
      const t = m.text();
      // Mensagens de desempenho do driver de software, causadas pelas capturas de tela do teste.
      if (t.includes('GL Driver Message') && t.includes('ReadPixels')) return ignored.push(t);
      // Tentativas de reconexão durante a queda de rede PROPOSITAL do teste.
      if (offlineWindow && t.includes('ERR_INTERNET_DISCONNECTED')) return ignored.push(t);
      consoleErrors[label]!.push(`[${m.type()}] ${t}`);
    });
    page.on('pageerror', (e) => consoleErrors[label]!.push(`[pageerror] ${e.message}`));
    return { ctx, page };
  };
  const A = await mkPage('A');
  const B = await mkPage('B');

  try {
    // ---- A cria a sala ----
    await A.page.goto(`${base}/?e2e=1`);
    await A.page.fill('[data-testid=nickname]', 'Operador_A');
    await A.page.click('[data-testid=login]');
    await A.page.click('[data-testid=create-room]');
    await A.page.waitForSelector('[data-testid=room-code]:not(:empty)');
    const code = (await A.page.textContent('[data-testid=room-code]'))!.trim();
    check('A cria sala com código de 6 caracteres', /^[A-Z2-9]{6}$/.test(code), code);
    await A.page.screenshot({ path: path.join(OUT, '01-lobby-anfitriao.png') });

    // ---- B entra pelo link de convite ----
    const invite = `${base}/?sala=${code}&e2e=1`;
    await B.page.goto(invite);
    await B.page.fill('[data-testid=nickname]', 'Operador_B');
    await B.page.click('[data-testid=login]');
    await B.page.waitForSelector('[data-testid=room-code]:not(:empty)');
    await A.page.waitForFunction(() => document.querySelectorAll('[data-testid=player-row]').length === 2);
    check('B entra pelo link de convite e ambos veem 2 jogadores', true);
    await B.page.screenshot({ path: path.join(OUT, '02-lobby-convidado.png') });

    // ---- início ----
    await A.page.click('[data-testid=start-match]');
    await Promise.all([
      A.page.waitForFunction(() => !!(window as unknown as { __vertice?: unknown }).__vertice),
      B.page.waitForFunction(() => !!(window as unknown as { __vertice?: unknown }).__vertice),
    ]);
    const hasRemote = () => ((window as unknown as { __vertice: { state: () => { remotes: unknown[] } } }).__vertice.state().remotes.length ?? 0) > 0;
    await A.page.waitForFunction(hasRemote, undefined, { timeout: 30_000 }).catch(() => undefined);
    await B.page.waitForFunction(hasRemote, undefined, { timeout: 30_000 }).catch(() => undefined);
    await sleep(1000);
    let sa = (await vstate(A.page))!;
    let sb = (await vstate(B.page))!;
    check('partida iniciou nos dois navegadores', !!sa && !!sb && sa.alive && sb.alive);
    check('cada um vê o outro como entidade remota', sa.remotes.length === 1 && sb.remotes.length === 1);
    const bId = sa.remotes[0]!.id;
    const aId = sb.remotes[0]!.id;

    // ---- movimento sincronizado (teclado real no B) ----
    teleport(srv, aId, -10, 0, 6, -Math.PI / 2);
    teleport(srv, bId, 8, 0, 6, Math.PI / 2);
    await sleep(800);
    sa = (await vstate(A.page))!;
    const before = sa.remotes[0]!;
    check('nome de B visível para A com linha de visão', before.labelVisible);
    await B.page.keyboard.down('KeyD');
    await sleep(900);
    await B.page.keyboard.up('KeyD');
    await sleep(500);
    sa = (await vstate(A.page))!;
    sb = (await vstate(B.page))!;
    const after = sa.remotes[0]!;
    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    const srvPos = matchPlayer(srv, bId).sim.move.pos;
    check('A vê B se mover (teclado no navegador B)', moved > 2, `${moved.toFixed(2)} m`);
    check('posição prevista de B = servidor', Math.hypot(sb.pos.x - srvPos.x, sb.pos.z - srvPos.z) < 0.05);
    await A.page.screenshot({ path: path.join(OUT, '03-partida-visao-A.png') });

    // ---- nome oculto atrás de parede ----
    // A no lado oeste do pilar central-norte; B atrás do pilar (0,11) a partir de A.
    teleport(srv, aId, 0, 0, 15.5, 0);
    teleport(srv, bId, 0, 0, 7.5, Math.PI);
    await sleep(800);
    await A.page.evaluate(() => (window as unknown as { __vertice: { look: (y: number, p: number) => void } }).__vertice.look(0, 0));
    await sleep(300);
    sa = (await vstate(A.page))!;
    check('nome de B OCULTO atrás do pilar', sa.remotes[0] ? !sa.remotes[0].labelVisible : false);
    await A.page.screenshot({ path: path.join(OUT, '04-nome-oculto-atras-do-pilar.png') });

    // ---- combate no navegador ----
    teleport(srv, aId, -10, 0, 6, -Math.PI / 2);
    teleport(srv, bId, 8, 0, 6, Math.PI / 2);
    await sleep(800);
    for (let i = 0; i < 12; i++) {
      await A.page.evaluate((id) => (window as unknown as { __vertice: { aimAt: (i: string) => boolean } }).__vertice.aimAt(id), bId);
      await A.page.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(true));
      await sleep(60);
      await A.page.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(false));
      await sleep(160);
      sb = (await vstate(B.page))!;
      if (!sb.alive) break;
    }
    await sleep(300);
    sb = (await vstate(B.page))!;
    sa = (await vstate(A.page))!;
    await A.page.screenshot({ path: path.join(OUT, '05-eliminacao-visao-A.png') });
    await B.page.screenshot({ path: path.join(OUT, '06-eliminado-visao-B.png') });
    const aKills = sa.score.find((r) => r.id === aId)?.kills ?? 0;
    check('disparos no navegador eliminam o alvo (validado no servidor)', !sb.alive && aKills >= 1, `abates de A: ${aKills}`);
    await sleep(3500);
    sb = (await vstate(B.page))!;
    check('B renasce após 3 s com 100 de vida', sb.alive && sb.hp === 100);

    // ---- queda de rede e reconexão ----
    offlineWindow = true;
    await B.ctx.setOffline(true);
    await sleep(8000);
    sa = (await vstate(A.page))!;
    const statusDuring = sa.score.find((r) => r.id === bId)?.status;
    await B.ctx.setOffline(false);
    await B.page.waitForFunction(() => {
      const v = (window as unknown as { __vertice?: { state: () => { alive: boolean } } }).__vertice;
      return v?.state().alive;
    }, undefined, { timeout: 20_000 });
    // Aguarda A receber o placar/snapshot com B de volta (até 15 s).
    await A.page
      .waitForFunction(
        (id) => {
          const st = (window as unknown as { __vertice: { state: () => { score: { id: string; status: string }[]; remotes: unknown[] } } }).__vertice.state();
          return st.score.find((r) => r.id === id)?.status === 'connected' && st.remotes.length === 1;
        },
        bId,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    offlineWindow = false;
    sa = (await vstate(A.page))!;
    check('A vê B como desconectado durante a queda', statusDuring === 'disconnected', String(statusDuring));
    const bRow = sa.score.find((r) => r.id === bId);
    check('B reconecta sozinho e volta à mesma partida', bRow?.status === 'connected' && sa.remotes.length === 1, `status ${bRow?.status} · remotos vistos por A ${sa.remotes.length}`);
    check('estatísticas de B preservadas após reconectar', (sa.score.find((r) => r.id === bId)?.deaths ?? 0) >= 1);

    // ---- estabilidade ----
    if (MINUTES > 0) {
      console.log(`mantendo a partida por ${MINUTES} min com movimento e disparos…`);
      const end = Date.now() + MINUTES * 60_000;
      const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
      let n = 0;
      const sA0 = (await vstate(A.page))!;
      const sB0 = (await vstate(B.page))!;
      let maxPredErr = 0;
      let lastTick = 0;
      let lastTickT = 0;
      let minTickRate = Infinity;
      let minSnap = Infinity;
      while (Date.now() < end) {
        for (const [P, target] of [[A.page, bId], [B.page, aId]] as const) {
          const k = keys[(n + (P === A.page ? 0 : 2)) % 4]!;
          await P.keyboard.down(k);
          if (n % 3 === 0) await P.keyboard.press('Space');
          await P.evaluate((id) => (window as unknown as { __vertice: { aimAt: (i: string) => boolean; fire: (o: boolean) => void } }).__vertice.aimAt(id), target);
          await P.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(true));
        }
        await sleep(120);
        for (const P of [A.page, B.page]) await P.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(false));
        await sleep(500);
        for (const P of [A.page, B.page]) for (const k of keys) await P.keyboard.up(k);
        if (n % 20 === 0) {
          const room = [...srv.game.rooms.values()][0];
          const tickNow = room?.match?.tick ?? 0;
          const tNow = performance.now();
          const tickRate = lastTickT ? ((tickNow - lastTick) * 1000) / (tNow - lastTickT) : 0;
          lastTick = tickNow;
          lastTickT = tNow;
          if (lastTickT && tickRate > 0) minTickRate = Math.min(minTickRate, tickRate);
          const s1 = (await vstate(A.page))!;
          maxPredErr = Math.max(maxPredErr, s1.predictionError);
          if (s1.snapRate > 0) minSnap = Math.min(minSnap, s1.snapRate);
          const left = Math.round((end - Date.now()) / 1000);
          console.log(`  ${left}s restantes · ticks do servidor ${tickRate.toFixed(0)}/s · FPS A ${s1.fps.toFixed(0)} · snapshots ${s1.snapRate.toFixed(0)}/s · placar ${s1.score.map((r) => `${r.kills}/${r.deaths}`).join(' ')}`);
        }
        n++;
      }
      const sA1 = (await vstate(A.page))!;
      const sB1 = (await vstate(B.page))!;
      const starvA = (sA1.starvedFrames - sA0.starvedFrames) / Math.max(1, sA1.framesTotal - sA0.framesTotal);
      const starvB = (sB1.starvedFrames - sB0.starvedFrames) / Math.max(1, sB1.framesTotal - sB0.framesTotal);
      check(`partida de ${MINUTES} min sem queda`, sA1.remotes.length === 1 && sB1.remotes.length === 1);
      check('interpolação sem buffer vazio (< 2% dos quadros)', starvA < 0.02 && starvB < 0.02, `A ${(starvA * 100).toFixed(2)}% · B ${(starvB * 100).toFixed(2)}%`);
      console.log(`  menor taxa de ticks do servidor: ${minTickRate.toFixed(0)}/s (meta 60)`);
      console.log(`  erro máx. de predição amostrado: ${(maxPredErr * 100).toFixed(1)} cm · menor taxa de snapshots: ${minSnap.toFixed(0)}/s`);
      await A.page.screenshot({ path: path.join(OUT, '07-apos-estabilidade-A.png') });
      // Placar (Tab)
      await A.page.keyboard.down('Tab');
      await sleep(200);
      await A.page.screenshot({ path: path.join(OUT, '08-placar-tab.png') });
      await A.page.keyboard.up('Tab');
    }

    const st = (await vstate(A.page))!;
    console.log(`métricas A: FPS ${st.fps.toFixed(0)} (SwiftShader, CPU) · draw calls ${st.drawCalls} · snapshots ${st.snapRate.toFixed(0)}/s`);
  } finally {
    const errsA = consoleErrors.A!;
    const errsB = consoleErrors.B!;
    check('sem erros/avisos no console do navegador A', errsA.length === 0, errsA.slice(0, 5).join(' | '));
    check('sem erros/avisos no console do navegador B', errsB.length === 0, errsB.slice(0, 5).join(' | '));
    check('sem erros/avisos no console do servidor', serverErrors.length === 0, serverErrors.slice(0, 5).join(' | '));
    await browser.close();
    await srv.close();
    const failed = results.filter((r) => !r.ok);
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify({ minutes: MINUTES, lag: LAG, results, consoleErrors, serverErrors }, null, 2));
    console.log(`(${ignored.length} mensagens ignoradas: driver de software/queda proposital)`);
    console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
    process.exit(failed.length ? 1 : 0);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
