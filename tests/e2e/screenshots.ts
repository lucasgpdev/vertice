/**
 * Gera capturas de tela de referência (personagem remoto de perto, viewmodel,
 * HUD) com dois navegadores. Uso: npm run build && node --import tsx tests/e2e/screenshots.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { createServer } from '../../server/src/createServer.js';
import { loadConfig } from '../../server/src/config.js';
import { teleport } from '../integration/serverHelpers.js';

const OUT = path.resolve('tests/e2e/output');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = Number(process.env.E2E_W ?? 1280);
const H = Number(process.env.E2E_H ?? 720);

const srv = await createServer({ ...loadConfig({}), port: 0, host: '127.0.0.1', logLevel: 'silent' });
const base = `http://127.0.0.1:${srv.port}`;
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'],
});
const mk = async (w = W, h = H): Promise<Page> => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript(() =>
    localStorage.setItem('vertice.settings.v1', JSON.stringify({ quality: 'medium', graphics: { shadows: 'low', renderScale: 1, antialias: false } })),
  );
  return ctx.newPage();
};
const A = await mk();
const B = await mk(320, 180); // B pequeno: poupa CPU (renderização por software)
await A.goto(`${base}/?e2e=1`);
await A.screenshot({ path: path.join(OUT, 'ref-login.png') });
await A.fill('[data-testid=nickname]', 'Kestrel');
await A.click('[data-testid=login]');
await A.waitForSelector('[data-testid=create-room]');
await sleep(300);
await A.screenshot({ path: path.join(OUT, 'ref-menu.png') });
await A.click('[data-testid=create-room]');
await A.waitForSelector('[data-testid=room-code]:not(:empty)');
const code = (await A.textContent('[data-testid=room-code]'))!.trim();
await B.goto(`${base}/?sala=${code}&e2e=1`);
await B.fill('[data-testid=nickname]', 'Marrom_07');
await B.click('[data-testid=login]');
await A.waitForFunction(() => document.querySelectorAll('[data-testid=player-row]').length === 2);
await A.screenshot({ path: path.join(OUT, 'ref-lobby.png') });
await A.click('[data-testid=start-match]');
await A.waitForFunction(() => !!(window as unknown as { __vertice?: unknown }).__vertice);
await B.waitForFunction(() => !!(window as unknown as { __vertice?: unknown }).__vertice);
const hasRemote = () => (window as unknown as { __vertice: { state: () => { remotes: unknown[] } } }).__vertice.state().remotes.length > 0;
await A.waitForFunction(hasRemote, undefined, { timeout: 60_000 });
await B.waitForFunction(hasRemote, undefined, { timeout: 60_000 });
const ids = await A.evaluate(() => (window as unknown as { __vertice: { state: () => { remotes: { id: string }[] } } }).__vertice.state().remotes.map((r) => r.id));
const bId = ids[0]!;
const aId = await B.evaluate(() => (window as unknown as { __vertice: { state: () => { remotes: { id: string }[] } } }).__vertice.state().remotes[0]!.id);
teleport(srv, aId, -8, 0, 6, -Math.PI / 2);
teleport(srv, bId, -4.2, 0, 7.2, Math.PI / 2 + 0.5);
await sleep(2500);
await A.evaluate(() => (window as unknown as { __vertice: { look: (y: number, p: number) => void } }).__vertice.look(-Math.PI / 2 - 0.25, -0.05));
await sleep(6000);
await A.screenshot({ path: path.join(OUT, 'ref-personagem.png') });
await B.keyboard.down('ControlLeft');
await sleep(6000);
await A.screenshot({ path: path.join(OUT, 'ref-personagem-agachado.png') });
await B.keyboard.up('ControlLeft');
await A.evaluate(() => (window as unknown as { __vertice: { look: (y: number, p: number) => void } }).__vertice.look(-Math.PI / 2, 0.05));
await A.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(true));
await sleep(100);
await A.screenshot({ path: path.join(OUT, 'ref-disparo.png') });
await A.evaluate(() => (window as unknown as { __vertice: { fire: (o: boolean) => void } }).__vertice.fire(false));
await browser.close();
await srv.close();
process.exit(0);
