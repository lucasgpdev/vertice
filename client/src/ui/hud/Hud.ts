import type { ScoreRow } from '@vertice/shared';
import { h, pingClass, svg } from '../dom.js';
import { settings } from '../../config/settings.js';

const HEART = `<svg class="hp-icon" viewBox="0 0 24 24"><path d="M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z" fill="currentColor"/></svg>`;
const SKULL_HS = `<svg class="hs" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="#ff4a4a" stroke-width="2"/><circle cx="8" cy="8" r="2" fill="#ff4a4a"/></svg>`;

/** HUD em DOM sobre o canvas: legível, leve e sem afetar o render 3D. */
export class Hud {
  readonly el: HTMLElement;
  private readonly crosshair = h('div', { class: 'crosshair' });
  private readonly hitmarker = h('div', { class: 'hitmarker' });
  private readonly hpBox = h('div', { class: 'hp-box' });
  private readonly hpNum = h('div', { class: 'hp-num' }, '100');
  private readonly hpBar = h('i');
  private readonly mag = h('span', { class: 'mag' }, '0');
  private readonly res = h('span', { class: 'res' }, '/ 0');
  private readonly weapon = h('div', { class: 'weapon-name' });
  private readonly reloadHint = h('div', { class: 'reload-hint' });
  private readonly timer = h('div', { class: 'timer' }, '--:--');
  private readonly youVal = h('div', { class: 'val' }, '0');
  private readonly leadVal = h('div', { class: 'val' }, '0');
  private readonly limitVal = h('div', { class: 'val' }, '0');
  private readonly feed = h('div', { class: 'hud-tr' });
  private readonly tl = h('div', { class: 'hud-tl' });
  private readonly dmgRing = h('div', { class: 'dmg-ring' });
  private readonly vignette = h('div', { class: 'vignette' });
  private readonly deathEl = h('div', { class: 'death', style: { display: 'none' } });
  private readonly sb = h('div', { class: 'scoreboard panel', style: { display: 'none' } });
  readonly debug = h('div', { class: 'debug', style: { display: 'none' } });
  private hitTimer = 0;
  private unsub: () => void;

  constructor() {
    this.hpBox.append(svg(HEART), h('div', {}, this.hpNum, h('div', { class: 'hp-bar' }, this.hpBar)));
    this.el = h(
      'div',
      { class: 'hud' },
      this.vignette,
      this.dmgRing,
      this.crosshair,
      this.hitmarker,
      h('div', { class: 'hud-bl' }, this.hpBox),
      h('div', { class: 'hud-br' }, this.reloadHint, h('div', { class: 'ammo' }, this.mag, this.res), this.weapon),
      h(
        'div',
        { class: 'hud-top' },
        h('div', { class: 'you' }, h('div', { class: 'lbl' }, 'Você'), this.youVal),
        h('div', {}, h('div', { class: 'lbl' }, 'Tempo'), this.timer),
        h('div', { class: 'lead' }, h('div', { class: 'lbl' }, 'Líder'), this.leadVal),
        h('div', {}, h('div', { class: 'lbl' }, 'Meta'), this.limitVal),
      ),
      this.feed,
      this.tl,
      this.debug,
      this.deathEl,
      this.sb,
    );
    this.applyCrosshair();
    this.unsub = settings.subscribe(() => this.applyCrosshair());
  }

  applyCrosshair(): void {
    const c = settings.value.crosshair;
    this.crosshair.style.setProperty('--ch-color', c.color);
    this.crosshair.innerHTML = '';
    const t = c.thickness;
    const L = c.size;
    const g = c.gap;
    const bar = (x: number, y: number, w: number, hh: number) =>
      h('i', { style: { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${hh}px` } });
    this.crosshair.append(
      bar(-t / 2, -g - L, t, L),
      bar(-t / 2, g, t, L),
      bar(-g - L, -t / 2, L, t),
      bar(g, -t / 2, L, t),
    );
    if (c.dot) this.crosshair.append(bar(-t / 2, -t / 2, t, t));
  }

  setHealth(hp: number): void {
    this.hpNum.textContent = String(Math.max(0, Math.round(hp)));
    this.hpBar.style.width = `${Math.max(0, hp)}%`;
    this.hpBox.classList.toggle('low', hp <= 30);
  }

  setAmmo(mag: number, reserve: number, weaponName: string, reloading: boolean, magSize: number): void {
    this.mag.textContent = String(mag);
    this.mag.classList.toggle('low', mag <= Math.ceil(magSize * 0.25));
    this.res.textContent = `/ ${reserve}`;
    this.weapon.textContent = weaponName;
    this.reloadHint.textContent = reloading ? 'Recarregando…' : mag === 0 ? (reserve > 0 ? 'Recarregue [R]' : 'Sem munição') : '';
  }

  setTimer(msLeft: number): void {
    const s = Math.max(0, Math.ceil(msLeft / 1000));
    this.timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  setScore(you: number, leader: number, limit: number): void {
    this.youVal.textContent = String(you);
    this.leadVal.textContent = String(leader);
    this.limitVal.textContent = String(limit);
  }

  setNet(ping: number, connected: boolean): void {
    this.tl.innerHTML = '';
    this.tl.append(
      h('span', { class: `ping ${pingClass(ping)}` }, `${Math.round(ping)} ms`),
      connected ? '' : h('span', { style: { color: 'var(--red)' } }, 'RECONECTANDO…'),
    );
  }

  hit(kind: 'body' | 'head' | 'kill'): void {
    const m = this.hitmarker;
    m.className = 'hitmarker';
    void m.offsetWidth; // reinicia a animação
    m.classList.add('show');
    if (kind !== 'body') m.classList.add('head');
    if (kind === 'kill') m.classList.add('kill');
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => (m.className = 'hitmarker'), 260);
  }

  /** Indicador de direção do dano (ângulo relativo à visão, radianos). */
  damageFrom(relAngle: number): void {
    const arc = h('div', { class: 'dmg-arc', style: { transform: `rotate(${relAngle}rad)`, opacity: '1' } });
    this.dmgRing.append(arc);
    requestAnimationFrame(() => (arc.style.opacity = '0'));
    setTimeout(() => arc.remove(), 900);
    this.vignette.style.opacity = '1';
    setTimeout(() => (this.vignette.style.opacity = '0'), 200);
  }

  killfeed(killer: string, victim: string, weapon: string, head: boolean, killerIsMe: boolean, victimIsMe: boolean): void {
    const row = h(
      'div',
      { class: `killfeed-row ${killerIsMe || victimIsMe ? 'me' : ''}` },
      h('span', { class: killerIsMe ? 'self' : 'k' }, killer),
      h('span', { class: 'wpn' }, weapon),
      head ? svg(SKULL_HS) : '',
      h('span', { class: victimIsMe ? 'self' : 'v' }, victim),
    );
    this.feed.prepend(row);
    while (this.feed.children.length > 5) this.feed.lastElementChild?.remove();
    setTimeout(() => row.remove(), 6000);
  }

  setDeath(show: boolean, killer?: string, eta?: number): void {
    this.deathEl.style.display = show ? '' : 'none';
    this.crosshair.style.display = show ? 'none' : '';
    if (!show) return;
    this.deathEl.innerHTML = '';
    this.deathEl.append(
      h('div', { class: 't' }, 'Eliminado por'),
      h('div', { class: 'who' }, killer ?? '—'),
      h('div', { class: 'eta' }, eta !== undefined ? `Renascendo em ${eta.toFixed(1)} s` : ''),
    );
  }

  setScoreboard(show: boolean, rows: ScoreRow[], selfId: string): void {
    this.sb.style.display = show ? '' : 'none';
    if (!show) return;
    this.sb.innerHTML = '';
    this.sb.append(
      h('div', { class: 'panel-head' }, h('h3', {}, 'Placar — Mata-mata')),
      h('div', { class: 'sb-row head' }, h('span', {}, '#'), h('span', {}, 'Jogador'), h('span', { class: 'num' }, 'Abates'), h('span', { class: 'num' }, 'Mortes'), h('span', { class: 'num' }, 'Pontos'), h('span', { class: 'num' }, 'Ping')),
      ...rows.map((r, i) =>
        h(
          'div',
          { class: `sb-row ${r.id === selfId ? 'me' : ''} ${r.status === 'disconnected' ? 'off' : ''}` },
          h('span', {}, String(i + 1)),
          h('span', {}, r.nickname, r.status === 'disconnected' ? h('span', { class: 'badge off', style: { marginLeft: '8px' } }, 'caiu') : ''),
          h('span', { class: 'num' }, String(r.kills)),
          h('span', { class: 'num' }, String(r.deaths)),
          h('span', { class: 'num' }, String(r.score)),
          h('span', { class: `num ping ${pingClass(r.ping)}` }, String(r.ping)),
        ),
      ),
    );
  }

  dispose(): void {
    this.unsub();
    this.el.remove();
  }
}
