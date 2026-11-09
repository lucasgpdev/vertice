import { DEFAULT_ROOM_SETTINGS, ROOM_CODE_LENGTH } from '@vertice/shared';
import type { MatchEndMsg, RoomSettings, RoomState } from '@vertice/shared';
import { Connection } from '../multiplayer/Connection.js';
import { Renderer } from '../core/Renderer.js';
import { Game } from '../core/Game.js';
import { AssetManager } from '../assets/AssetManager.js';
import { registerProceduralAssets } from '../assets/registerAssets.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { LoginScreen } from '../ui/screens/LoginScreen.js';
import { MenuScreen } from '../ui/screens/MenuScreen.js';
import { LobbyScreen } from '../ui/screens/LobbyScreen.js';
import { openSettings } from '../ui/screens/SettingsModal.js';
import { h, toast } from '../ui/dom.js';

const NICK_KEY = 'vertice.nickname';
const TAB_NICK_KEY = 'vertice.tabNickname';

/** Orquestra telas, conexão e partida. */
export class App {
  private readonly conn = new Connection();
  private readonly renderer: Renderer;
  private readonly assets = new AssetManager();
  private readonly audio = new AudioSystem();
  private screen: HTMLElement | null = null;
  private lobby: LobbyScreen | null = null;
  private game: Game | null = null;
  private room: RoomState | null = null;
  private readonly names = new Map<string, string>();
  private pendingInvite: string | null;

  constructor(private readonly ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
    this.renderer.clear();
    registerProceduralAssets(this.assets);
    this.pendingInvite = this.readInvite();
    this.wire();
  }

  private readInvite(): string | null {
    const p = new URLSearchParams(location.search).get('sala');
    if (p && p.length === ROOM_CODE_LENGTH) return p.toUpperCase();
    return null;
  }

  private setUrlRoom(code: string | null): void {
    const u = new URL(location.href);
    if (code) u.searchParams.set('sala', code);
    else u.searchParams.delete('sala');
    history.replaceState(null, '', u);
  }

  inviteUrl(code: string): string {
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('sala', code);
    return u.toString();
  }

  private show(el: HTMLElement | null): void {
    this.screen?.remove();
    this.screen = el;
    if (el) this.ui.append(el);
  }

  start(): void {
    // Na mesma aba (ex.: recarregar a página), entra direto e retoma a sessão.
    const tabNick = sessionStorage.getItem(TAB_NICK_KEY);
    if (tabNick) void this.login(tabNick);
    else this.showLogin();
  }

  private showLogin(): void {
    this.show(
      LoginScreen({
        initial: localStorage.getItem(NICK_KEY) ?? '',
        inviteCode: this.pendingInvite,
        onSubmit: (nick) => this.login(nick),
      }),
    );
  }

  private async login(nick: string): Promise<string | null> {
    this.show(h('div', { class: 'loading' }, h('div', {}, h('div', { class: 'eyebrow' }, 'Conectando ao servidor'), h('div', { class: 'bar' }, h('i')))));
    try {
      const hello = await this.conn.start(nick);
      localStorage.setItem(NICK_KEY, nick);
      sessionStorage.setItem(TAB_NICK_KEY, nick);
      if (hello.resumedRoom) return null; // room:state chega em seguida
      if (this.pendingInvite) {
        const code = this.pendingInvite;
        this.pendingInvite = null;
        const err = await this.join(code);
        if (err) {
          toast(err, 'err');
          this.setUrlRoom(null);
          this.showMenu();
        }
        return null;
      }
      this.showMenu();
      return null;
    } catch {
      this.showLogin();
      return 'Não foi possível conectar ao servidor.';
    }
  }

  private showMenu(): void {
    this.lobby = null;
    this.show(
      MenuScreen({
        nickname: this.conn.nickname,
        connected: this.conn.connected,
        onCreate: async () => {
          const r = await this.conn.call<{ code: string }>('room:create', { settings: DEFAULT_ROOM_SETTINGS });
          if (!r.ok) return r.error;
          this.setUrlRoom(r.code);
          return null;
        },
        onJoin: (code) => this.join(code),
        onSettings: () => openSettings(this.ui, this.renderer.antialiasAtStart),
        onLogout: () => {
          sessionStorage.clear();
          location.href = location.pathname;
        },
      }),
    );
  }

  private async join(code: string): Promise<string | null> {
    const r = await this.conn.call<{ code: string }>('room:join', { code });
    if (!r.ok) return r.error;
    this.setUrlRoom(r.code);
    return null;
  }

  private showLobby(): void {
    if (!this.lobby) {
      this.lobby = new LobbyScreen({
        selfId: this.conn.playerId,
        inviteUrl: (c) => this.inviteUrl(c),
        onUpdate: async (s: RoomSettings) => {
          const r = await this.conn.call('room:update', { settings: s });
          return r.ok ? null : r.error;
        },
        onStart: async () => {
          const r = await this.conn.call('match:start', {});
          return r.ok ? null : r.error;
        },
        onKick: async (id) => {
          const r = await this.conn.call('room:kick', { playerId: id });
          return r.ok ? null : r.error;
        },
        onLeave: () => void this.leaveRoom(),
        onSettings: () => openSettings(this.ui, this.renderer.antialiasAtStart),
      });
      this.show(this.lobby.el);
    }
    if (this.room) this.lobby.update(this.room);
  }

  private async leaveRoom(): Promise<void> {
    await this.conn.call('room:leave', {});
    this.room = null;
    this.endGame();
    this.setUrlRoom(null);
    this.showMenu();
  }

  private endGame(): void {
    if (this.game) {
      this.game.dispose();
      this.game = null;
      this.renderer.clear();
    }
  }

  private wire(): void {
    this.conn.on('room:state', (s) => {
      this.room = s;
      for (const p of s.players) this.names.set(p.id, p.nickname);
      if (s.phase === 'lobby' && this.game) this.endGame();
      if (!this.game) this.showLobby();
    });
    this.conn.on('room:kicked', (m) => {
      this.room = null;
      this.endGame();
      this.setUrlRoom(null);
      toast(m.reason, 'err', 5000);
      this.showMenu();
    });
    this.conn.on('score', (rows) => {
      for (const r of rows) this.names.set(r.id, r.nickname);
    });
    this.conn.on('match:start', (m) => {
      if (this.game) {
        this.game.resume(m);
        return;
      }
      this.show(null);
      this.lobby = null;
      this.game = new Game(this.renderer, this.conn, this.assets, this.audio, this.ui, m, {
        nameOf: (id) => this.names.get(id) ?? '???',
        isHost: () => this.room?.hostId === this.conn.playerId,
        openSettings: () => openSettings(this.ui, this.renderer.antialiasAtStart),
        leaveRoom: () => void this.leaveRoom(),
        endMatch: () => void this.conn.call('match:end', {}),
      });
    });
    this.conn.on('match:end', (m) => this.game?.showResults(this.resultsView(m)));
    this.conn.onStatus((ok) => {
      if (!ok && !this.conn.fatal) toast('Conexão perdida — tentando reconectar…', 'err', 4000);
      if (this.conn.fatal) {
        toast(this.conn.fatal, 'err', 10_000);
        this.endGame();
        this.show(h('div', { class: 'screen' }, h('div', { class: 'center-msg' }, h('div', { class: 'title' }, 'Sessão encerrada'), h('p', { class: 'hint' }, this.conn.fatal))));
      }
    });
    // Reconexão automática: se a sessão expirou, volta ao menu.
    this.conn.onHello((hello) => {
      if (!hello.resumedRoom && (this.room || this.game)) {
        this.room = null;
        this.endGame();
        this.setUrlRoom(null);
        toast('A janela de reconexão expirou. Você saiu da sala.', 'err', 6000);
        this.showMenu();
      }
    });
  }

  private resultsView(m: MatchEndMsg): HTMLElement {
    const winner = m.winnerId ? (this.names.get(m.winnerId) ?? '???') : null;
    const reason = { killLimit: 'Limite de abates atingido', timeLimit: 'Tempo esgotado', host: 'Encerrada pelo anfitrião', notEnoughPlayers: 'Jogadores insuficientes' }[m.reason];
    const eta = h('span', {}, String(Math.round(m.backToLobbyInMs / 1000)));
    let left = Math.round(m.backToLobbyInMs / 1000);
    const iv = window.setInterval(() => {
      left = Math.max(0, left - 1);
      eta.textContent = String(left);
      if (left === 0 || !eta.isConnected) window.clearInterval(iv);
    }, 1000);
    return h(
      'div',
      { class: 'results' },
      h(
        'div',
        { class: 'panel', style: { width: 'min(760px, 94vw)' } },
        h('div', { class: 'panel-head' }, h('h3', {}, 'Fim de partida'), h('span', { class: 'hint' }, reason)),
        h(
          'div',
          { class: 'panel-body' },
          h('div', { class: 'eyebrow' }, winner ? 'Vencedor' : 'Resultado'),
          h('div', { class: 'winner', 'data-testid': 'winner' }, winner ?? 'Sem vencedor'),
          h(
            'div',
            { style: { marginTop: '18px' } },
            h('div', { class: 'sb-row head' }, h('span', {}, '#'), h('span', {}, 'Jogador'), h('span', { class: 'num' }, 'Abates'), h('span', { class: 'num' }, 'Mortes'), h('span', { class: 'num' }, 'Pontos'), h('span', { class: 'num' }, 'Ping')),
            ...m.scoreboard.map((r, i) =>
              h('div', { class: `sb-row ${r.id === this.conn.playerId ? 'me' : ''}` }, h('span', {}, String(i + 1)), h('span', {}, r.nickname), h('span', { class: 'num' }, String(r.kills)), h('span', { class: 'num' }, String(r.deaths)), h('span', { class: 'num' }, String(r.score)), h('span', { class: 'num' }, String(r.ping))),
            ),
          ),
          h('div', { class: 'hint', style: { marginTop: '16px' } }, 'Voltando ao lobby em ', eta, ' s. XP, recompensas e histórico chegam nas próximas fases.'),
        ),
      ),
    );
  }
}
