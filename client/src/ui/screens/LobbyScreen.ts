import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_PER_ROOM } from '@vertice/shared';
import type { RoomSettings, RoomState } from '@vertice/shared';
import { avatar, h, pingClass, toast } from '../dom.js';

interface LobbyOpts {
  selfId: string;
  inviteUrl: (code: string) => string;
  onUpdate: (s: RoomSettings) => Promise<string | null>;
  onStart: () => Promise<string | null>;
  onKick: (id: string) => Promise<string | null>;
  onLeave: () => void;
  onSettings: () => void;
}

const FUTURE_MODES = ['Competitivo 5v5', 'Duelo 1v1', 'Gun Game', 'Sobrevivência', 'Treinamento', 'Personalizada'];
const FUTURE_MAPS = ['Industrial Zone', 'Urban Warfare', 'Desert Base', 'Cyber Facility'];

/** Lobby da sala: código, convite, jogadores, configurações do anfitrião. */
export class LobbyScreen {
  readonly el: HTMLElement;
  private readonly codeEl = h('span', { class: 'code', 'data-testid': 'room-code' });
  private readonly players = h('div', { class: 'players' });
  private readonly settingsBody = h('div', { class: 'panel-body settings-grid' });
  private readonly actions = h('div', { class: 'lobby-actions' });
  private readonly phaseEl = h('div', { class: 'hint' });
  private state: RoomState | null = null;
  private controls: Partial<Record<keyof RoomSettings, HTMLSelectElement>> = {};

  constructor(private readonly o: LobbyOpts) {
    const copy = h('button', { class: 'btn sm', 'data-testid': 'copy-invite', on: { click: () => void this.copyInvite() } }, 'Copiar link de convite');
    this.el = h(
      'div',
      { class: 'screen' },
      h(
        'div',
        { class: 'lobby' },
        h(
          'div',
          { class: 'lobby-head' },
          h('div', {}, h('div', { class: 'eyebrow' }, 'Sala privada'), h('div', { class: 'room-code' }, this.codeEl, copy), this.phaseEl),
          h('div', { class: 'row' }, h('button', { class: 'btn ghost', on: { click: o.onSettings } }, 'Configurações'), h('button', { class: 'btn ghost', 'data-testid': 'leave', on: { click: o.onLeave } }, 'Sair da sala')),
        ),
        h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Jogadores'), h('span', { class: 'hint', 'data-testid': 'player-count' })), this.players),
        h('div', {}, h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', {}, 'Partida')), this.settingsBody), this.actions),
      ),
    );
  }

  private async copyInvite(): Promise<void> {
    if (!this.state) return;
    const url = this.o.inviteUrl(this.state.code);
    try {
      await navigator.clipboard.writeText(url);
      toast('Link de convite copiado.');
    } catch {
      // Sem permissão de área de transferência: mostra para copiar manualmente.
      window.prompt('Copie o link de convite:', url);
    }
  }

  update(s: RoomState): void {
    const first = !this.state || this.state.code !== s.code;
    this.state = s;
    const isHost = s.hostId === this.o.selfId;
    this.codeEl.textContent = s.code;
    this.phaseEl.textContent =
      s.phase === 'playing' ? 'Partida em andamento — entrando…' : s.phase === 'results' ? 'Resultados — voltando ao lobby em instantes' : isHost ? 'Você é o anfitrião.' : 'Aguardando o anfitrião iniciar.';

    // jogadores
    this.players.innerHTML = '';
    for (const p of s.players) {
      const me = p.id === this.o.selfId;
      const kick =
        isHost && !me
          ? h('button', {
              class: 'btn sm danger',
              on: {
                click: async () => {
                  const e = await this.o.onKick(p.id);
                  if (e) toast(e, 'err');
                },
              },
            }, 'Expulsar')
          : h('span');
      this.players.append(
        h(
          'div',
          { class: 'player-row', 'data-testid': 'player-row' },
          avatar(p.nickname),
          h(
            'div',
            { class: 'name' },
            p.nickname,
            p.isHost ? h('span', { class: 'badge host' }, 'Anfitrião') : '',
            me ? h('span', { class: 'badge you' }, 'Você') : '',
            p.status === 'disconnected' ? h('span', { class: 'badge off' }, 'Reconectando') : '',
          ),
          h('span', { class: 'hint' }, 'Todos × todos'),
          h('span', { class: `ping ${pingClass(p.ping)}` }, p.ping > 0 ? `${p.ping} ms` : '— ms'),
          kick,
        ),
      );
    }
    for (let i = s.players.length; i < s.settings.maxPlayers; i++) this.players.append(h('div', { class: 'slot-empty' }, 'Vaga livre'));
    (this.el.querySelector('[data-testid=player-count]') as HTMLElement).textContent = `${s.players.length} / ${s.settings.maxPlayers}`;

    if (first || !isHost) this.renderSettings(s, isHost);
    else this.syncSettings(s);

    // ações
    this.actions.innerHTML = '';
    const connected = s.players.filter((p) => p.status === 'connected').length;
    if (isHost) {
      const start = h(
        'button',
        {
          class: 'btn primary grow',
          'data-testid': 'start-match',
          disabled: s.phase !== 'lobby' || connected < 2,
          on: {
            click: async () => {
              start.disabled = true;
              const e = await this.o.onStart();
              if (e) {
                toast(e, 'err');
                start.disabled = false;
              }
            },
          },
        },
        'Iniciar partida',
      );
      this.actions.append(start);
      if (connected < 2) this.actions.append(h('span', { class: 'hint' }, 'Mínimo de 2 jogadores.'));
    } else this.actions.append(h('span', { class: 'hint' }, 'Somente o anfitrião inicia a partida.'));
  }

  private select<K extends keyof RoomSettings>(key: K, options: { v: RoomSettings[K] | string; label: string; disabled?: boolean }[], s: RoomSettings, enabled: boolean): HTMLSelectElement {
    const sel = h('select', { class: 'select', disabled: !enabled });
    for (const op of options) {
      const o = h('option', { value: String(op.v), disabled: !!op.disabled }, op.label);
      sel.append(o);
    }
    sel.value = String(s[key]);
    sel.addEventListener('change', async () => {
      const cur = this.state!.settings;
      const raw = sel.value;
      const next: RoomSettings = { ...cur, [key]: typeof cur[key] === 'number' ? Number(raw) : raw };
      const e = await this.o.onUpdate(next);
      if (e) {
        toast(e, 'err');
        sel.value = String(cur[key]);
      }
    });
    this.controls[key] = sel;
    return sel;
  }

  private renderSettings(s: RoomState, isHost: boolean): void {
    const st = s.settings;
    const en = isHost && s.phase === 'lobby';
    const range = (a: number, b: number, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);
    this.controls = {};
    this.settingsBody.innerHTML = '';
    const field = (label: string, ctrl: HTMLElement) => h('div', { class: 'field' }, h('label', {}, label), ctrl);
    this.settingsBody.append(
      field('Modo', this.select('modeId', [{ v: 'deathmatch', label: 'Mata-mata' }, ...FUTURE_MODES.map((m) => ({ v: m, label: `${m} (em breve)`, disabled: true }))], st, en)),
      field('Mapa', this.select('mapId', [{ v: 'arena-patio7', label: 'Pátio 7 (arena)' }, ...FUTURE_MAPS.map((m) => ({ v: m, label: `${m} (em breve)`, disabled: true }))], st, en)),
      field('Limite de jogadores', this.select('maxPlayers', range(MIN_PLAYERS_PER_ROOM, MAX_PLAYERS_PER_ROOM).map((n) => ({ v: n, label: String(n) })), st, en)),
      field('Limite de abates', this.select('killLimit', [5, 10, 15, 20, 25, 30, 40, 50].map((n) => ({ v: n, label: String(n) })), st, en)),
      field('Tempo (min)', this.select('timeLimitMin', [2, 3, 5, 8, 10, 15, 20, 30].map((n) => ({ v: n, label: `${n} min` })), st, en)),
    );
  }

  private syncSettings(s: RoomState): void {
    for (const [k, sel] of Object.entries(this.controls) as [keyof RoomSettings, HTMLSelectElement][]) {
      if (document.activeElement !== sel) sel.value = String(s.settings[k]);
      sel.disabled = s.phase !== 'lobby';
    }
  }
}
