import { DEFAULT_WEAPON_ID } from '@vertice/shared';
import type { LobbyPlayer, MatchEndMsg, RoomPhase, RoomSettings, RoomState, ScoreRow } from '@vertice/shared';
import type { PlayerSession } from '../players/PlayerSession.js';
import { Match } from '../matches/Match.js';
import type { MatchOptions } from '../matches/Match.js';
import { log } from '../core/logger.js';

/** Sala privada: membros, anfitrião, configurações e a partida atual. */
export class Room {
  readonly members = new Map<string, PlayerSession>();
  /** Ordem de entrada (para transferir o anfitrião). */
  private order: string[] = [];
  hostId: string;
  phase: RoomPhase = 'lobby';
  match: Match | null = null;
  lastResults: ScoreRow[] = [];
  private readonly kicked = new Set<string>();
  private resultsTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly code: string,
    host: PlayerSession,
    public settings: RoomSettings,
    private readonly matchOpts: MatchOptions,
    private readonly clock: () => number,
  ) {
    this.hostId = host.id;
  }

  get connectedCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.connected) n++;
    return n;
  }

  isFull(): boolean {
    return this.members.size >= this.settings.maxPlayers;
  }

  isKicked(token: string): boolean {
    return this.kicked.has(token);
  }

  add(s: PlayerSession): void {
    this.members.set(s.id, s);
    if (!this.order.includes(s.id)) this.order.push(s.id);
    s.roomCode = this.code;
    if (this.phase === 'playing' && this.match) this.match.addPlayer(s, this.clock());
    this.broadcastState();
  }

  remove(id: string): void {
    const s = this.members.get(id);
    if (!s) return;
    this.members.delete(id);
    this.order = this.order.filter((x) => x !== id);
    s.roomCode = null;
    this.match?.removePlayer(id);
    if (this.hostId === id) this.transferHost();
    if (this.phase === 'playing' && this.match && this.members.size < 1) this.match.finish('notEnoughPlayers');
    this.broadcastState();
  }

  kick(targetId: string): boolean {
    const s = this.members.get(targetId);
    if (!s || targetId === this.hostId) return false;
    this.kicked.add(s.token);
    s.emit('room:kicked', { reason: 'Você foi removido pelo anfitrião.' });
    this.remove(targetId);
    return true;
  }

  /** Passa o anfitrião para o próximo membro conectado (ou qualquer membro). */
  transferHost(): void {
    const next = this.order.find((id) => this.members.get(id)?.connected) ?? this.order[0];
    if (next) {
      this.hostId = next;
      log.info(`sala ${this.code}: novo anfitrião ${this.members.get(next)?.nickname}`);
    }
  }

  onMemberDisconnected(id: string): void {
    this.match?.onDisconnect(id);
    if (this.hostId === id) {
      const other = this.order.find((x) => x !== id && this.members.get(x)?.connected);
      if (other) this.hostId = other;
    }
    this.broadcastState();
  }

  onMemberReconnected(s: PlayerSession): void {
    if (this.phase === 'playing' && this.match) this.match.addPlayer(s, this.clock());
    this.broadcastState();
  }

  startMatch(): void {
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
    this.resultsTimer = null;
    const now = this.clock();
    this.match = new Match(this.settings, now, { onEnd: (r) => this.onMatchEnd(r) }, this.matchOpts);
    this.phase = 'playing';
    for (const s of this.members.values()) if (s.connected) this.match.addPlayer(s, now);
    log.info(`sala ${this.code}: partida iniciada com ${this.connectedCount} jogador(es)`);
    this.broadcastState();
  }

  private onMatchEnd(r: MatchEndMsg): void {
    this.phase = 'results';
    this.lastResults = r.scoreboard;
    for (const s of this.members.values()) s.emit('match:end', r);
    log.info(`sala ${this.code}: partida encerrada (${r.reason})`);
    this.broadcastState();
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      if (this.phase !== 'results') return;
      this.phase = 'lobby';
      this.match = null;
      this.broadcastState();
    }, r.backToLobbyInMs);
  }

  step(now: number): void {
    if (this.phase === 'playing' && this.match) this.match.step(now);
  }

  state(): RoomState {
    const stats = new Map<string, { kills: number; deaths: number; score: number }>();
    if (this.match) for (const p of this.match.players.values()) stats.set(p.id, p);
    else for (const r of this.lastResults) stats.set(r.id, r);
    const players: LobbyPlayer[] = this.order
      .map((id) => this.members.get(id))
      .filter((s): s is PlayerSession => !!s)
      .map((s) => {
        const st = stats.get(s.id);
        return {
          id: s.id,
          nickname: s.nickname,
          ping: s.ping,
          status: s.connected ? 'connected' : 'disconnected',
          isHost: s.id === this.hostId,
          team: 'ffa',
          kills: st?.kills ?? 0,
          deaths: st?.deaths ?? 0,
          score: st?.score ?? 0,
          level: 1,
          weaponId: DEFAULT_WEAPON_ID,
        };
      });
    return { code: this.code, hostId: this.hostId, phase: this.phase, settings: this.settings, players };
  }

  broadcastState(): void {
    const st = this.state();
    for (const s of this.members.values()) s.emit('room:state', st);
  }

  dispose(): void {
    if (this.resultsTimer) clearTimeout(this.resultsTimer);
  }
}
